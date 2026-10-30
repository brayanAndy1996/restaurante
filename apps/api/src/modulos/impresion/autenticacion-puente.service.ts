import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import type { PuenteAutenticado, VinculacionAutenticada } from '../../nucleo/principal';
import type { PuenteDeConexion, ValidadorDePuente } from '../../nucleo/tiempo-real';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { Credenciales, parsearTokenPuente, parsearTokenVinculacion } from '../seguridad';

/** Huella de relleno para comparar igual cuando no hay fila (32 bytes, como una huella SHA-256). */
const SIN_HUELLA = Buffer.alloc(32);

const MENSAJE_NO_AUTENTICADO = 'Se requiere autenticación para esta operación';

/** 401 `NO_AUTENTICADO`, siempre con el mismo cuerpo (no distingue entre token, puente, empresa o secreto). */
export const puenteNoAutenticado = (): ErrorAplicacion =>
  new ErrorAplicacion(401, 'NO_AUTENTICADO', MENSAJE_NO_AUTENTICADO);

/**
 * 401 `VINCULACION_INVALIDA`, siempre con el mismo cuerpo: vencida, usada, invalidada, de otra vinculación,
 * adulterada (empresa, id o secreto cambiados) o inexistente (criterio 107).
 */
export const vinculacionInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    401,
    'VINCULACION_INVALIDA',
    'El código de vinculación no es válido, venció o ya se usó',
  );

/**
 * Autenticación del puente de impresión (historia 004, 3b, criterios 107, 109 y 111; ruta crítica P6). La usan los
 * guards de las rutas `/puente/*` y el espacio `/puente` de Socket.IO, así que HTTP y Socket.IO aplican exactamente
 * las mismas reglas.
 *
 * Toda comprobación abre un contexto de empresa propio con la empresa **del token** y lee la fila bajo la RLS: un
 * token con la empresa cambiada no encuentra el puente (o la vinculación) de la empresa original, y uno de otra
 * empresa no ve nada. El secreto se compara por su huella SHA-256 en tiempo constante. No hay bloqueo por intentos:
 * el secreto tiene 256 bits (criterio 109).
 */
@Injectable()
export class AutenticacionPuenteService implements ValidadorDePuente {
  constructor(
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** El puente activo de un token `pu.…`, o 401 `NO_AUTENTICADO` si está mal formado, adulterado o revocado. */
  async autenticarPuente(token: string | null | undefined): Promise<PuenteAutenticado> {
    const partes = typeof token === 'string' && token !== '' ? parsearTokenPuente(token) : null;
    if (partes === null) throw puenteNoAutenticado();
    const puente = await this.contexto.ejecutar(partes.empresaId, async () => {
      const filas = await this.conexion.query<{ sucursal_id: string; huella_secreto: Buffer }>(
        'SELECT sucursal_id, huella_secreto FROM puente WHERE id = $1 AND activo',
        { bind: [partes.puenteId], type: QueryTypes.SELECT },
      );
      const fila = filas[0];
      // Con o sin fila se compara el secreto presentado: la respuesta no delata si el puente existe.
      const coincide = this.credenciales.secretoCoincide(
        partes.secreto,
        fila?.huella_secreto ?? SIN_HUELLA,
      );
      if (fila === undefined || !coincide) return null;
      return { sucursalId: fila.sucursal_id };
    });
    if (puente === null) throw puenteNoAutenticado();
    return {
      empresaId: partes.empresaId,
      puenteId: partes.puenteId,
      sucursalId: puente.sucursalId,
    };
  }

  /**
   * La vinculación vigente de un código `vi.…` (criterio 107): sin usar, sin invalidar, sin vencer (con el reloj de
   * la API) y con el secreto correcto. Mal formado: 401 `NO_AUTENTICADO`; bien formado pero que no sirve: 401
   * `VINCULACION_INVALIDA`, el mismo cuerpo en todos los casos. No gasta el código: lo hace `VinculacionesService`
   * con un `UPDATE` condicionado, para que de dos usos simultáneos gane exactamente uno.
   */
  async autenticarVinculacion(token: string | null | undefined): Promise<VinculacionAutenticada> {
    const partes = typeof token === 'string' && token !== '' ? parsearTokenVinculacion(token) : null;
    if (partes === null) throw puenteNoAutenticado();
    const ahora = this.reloj.ahora();
    const vinculacion = await this.contexto.ejecutar(partes.empresaId, async () => {
      const filas = await this.conexion.query<{ sucursal_id: string; huella_secreto: Buffer }>(
        `SELECT sucursal_id, huella_secreto FROM vinculacion_puente
          WHERE id = $1 AND usada_en IS NULL AND invalidada_en IS NULL AND expira_en > $2`,
        { bind: [partes.vinculacionId, ahora], type: QueryTypes.SELECT },
      );
      const fila = filas[0];
      const coincide = this.credenciales.secretoCoincide(
        partes.secreto,
        fila?.huella_secreto ?? SIN_HUELLA,
      );
      if (fila === undefined || !coincide) return null;
      return { sucursalId: fila.sucursal_id };
    });
    if (vinculacion === null) throw vinculacionInvalida();
    return {
      empresaId: partes.empresaId,
      vinculacionId: partes.vinculacionId,
      sucursalId: vinculacion.sucursalId,
      puenteIdNuevo: randomUUID(),
    };
  }

  // ---- ValidadorDePuente (Socket.IO) --------------------------------------------------------------

  validar(token: string | null | undefined): Promise<PuenteDeConexion> {
    return this.autenticarPuente(token);
  }

  /** La señal del puente al conectarse (criterio 111): `ultima_senal_en` con el reloj de la API. */
  alConectar(puente: PuenteDeConexion): Promise<void> {
    return this.marcarSenal(puente);
  }

  /** La señal del puente al desconectarse (criterio 111). */
  alDesconectar(puente: PuenteDeConexion): Promise<void> {
    return this.marcarSenal(puente);
  }

  private async marcarSenal(puente: PuenteDeConexion): Promise<void> {
    const ahora = this.reloj.ahora();
    await this.contexto.ejecutar(
      puente.empresaId,
      async () => {
        // Un puente revocado no deja señal (la conexión se cierra al revocarlo).
        await this.conexion.query(
          `UPDATE puente SET ultima_senal_en = $2, actualizado_en = $2
            WHERE id = $1 AND activo`,
          { bind: [puente.puenteId, ahora], type: QueryTypes.UPDATE },
        );
      },
      { actor: { sistema: `puente:${puente.puenteId}` } },
    );
  }
}
