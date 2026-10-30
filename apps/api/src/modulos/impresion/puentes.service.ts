import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  MINUTOS_VIGENCIA_VINCULACION,
  armarQrPuente,
  type ConfiguracionPuente,
  type PuenteRespuesta,
  type VinculacionRespuesta,
  type VincularPuenteEntrada,
  type VincularPuenteRespuesta,
} from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import type { PuenteAutenticado, VinculacionAutenticada } from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { ServidorTiempoReal } from '../../nucleo/tiempo-real';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import { Credenciales, armarTokenPuente, armarTokenVinculacion } from '../seguridad';
import { vinculacionInvalida } from './autenticacion-puente.service';
import { noEncontrado } from './errores-impresion';

const NOMBRE_POR_DEFECTO = 'Puente de impresión';

interface FilaPuente {
  id: string;
  nombre: string;
  activo: boolean;
  modelo: string | null;
  version_app: string | null;
  creado_en: Date;
  revocado_en: Date | null;
  ultima_senal_en: Date | null;
}

const iso = (fecha: Date | null): string | null =>
  fecha === null ? null : new Date(fecha).toISOString();

/**
 * Vinculación y puentes de la sucursal (historia 004, 3b, criterios 106 a 108 y 110; ruta crítica P6).
 *
 * - **Código de vinculación (106):** `vi.<empresa>.<id>.<secreto>` con un secreto de 32 bytes aleatorios del que
 *   solo se guarda la huella; vence a los 10 minutos con el reloj de la API; crear otro invalida los pendientes de
 *   esa sucursal.
 * - **Vincular (107):** un solo uso (un `UPDATE … WHERE usada_en IS NULL` condicionado, bajo un cerrojo de
 *   transacción por sucursal: de dos usos simultáneos gana exactamente uno); revoca al puente activo anterior de la
 *   sucursal y cierra su conexión de Socket.IO después de confirmar (108). La petición ya corre con el actor
 *   `puente:<id del puente nuevo>`.
 * - **Revocar (108):** `DELETE` es idempotente (repetirlo es 204 sin efecto ni auditoría).
 */
@Injectable()
export class PuentesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(ServidorTiempoReal) private readonly tiempoReal: ServidorTiempoReal,
  ) {}

  // ---- Administrador ------------------------------------------------------------------------------

  /** `POST /sucursales/:sucursalId/vinculaciones-puente` (criterio 106). */
  async crearVinculacion(sucursalId: string): Promise<VinculacionRespuesta> {
    await this.exigirSucursal(sucursalId);
    const api = this.entorno.API_URL_PUBLICA;
    if (api === undefined) {
      throw new Error(
        'API_URL_PUBLICA no está configurada: no se puede armar el QR de vinculación',
      );
    }
    const ahora = this.reloj.ahora();
    const empresaId = this.contexto.empresaActual();
    const expiraEn = new Date(ahora.getTime() + MINUTOS_VIGENCIA_VINCULACION * 60_000);
    // Los códigos pendientes de la sucursal dejan de servir.
    await this.conexion.query(
      `UPDATE vinculacion_puente SET invalidada_en = $2, actualizado_en = $2
        WHERE sucursal_id = $1 AND usada_en IS NULL AND invalidada_en IS NULL`,
      { bind: [sucursalId, ahora], type: QueryTypes.UPDATE },
    );
    const id = randomUUID();
    const secreto = this.credenciales.generarSecreto();
    await this.conexion.query(
      `INSERT INTO vinculacion_puente (id, empresa_id, sucursal_id, huella_secreto, expira_en, creado_en,
                                       actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      {
        bind: [
          id,
          empresaId,
          sucursalId,
          this.credenciales.huellaSecreto(secreto),
          expiraEn,
          ahora,
        ],
        type: QueryTypes.INSERT,
      },
    );
    await this.auditoria.registrar({
      accion: 'crear_vinculacion_puente',
      sucursalId,
      entidad: 'puente',
      entidadId: id,
      detalle: { sucursalId, vinculacionId: id, expiraEn: expiraEn.toISOString() },
    });
    const token = armarTokenVinculacion(empresaId, id, secreto);
    return { token, qr: armarQrPuente(api, token), expiraEn: expiraEn.toISOString() };
  }

  /** `GET /sucursales/:sucursalId/puentes` (criterio 108): activos y revocados, el más nuevo primero. */
  async listar(sucursalId: string): Promise<PuenteRespuesta[]> {
    await this.exigirSucursal(sucursalId);
    const filas = await this.conexion.query<FilaPuente>(
      `SELECT id, nombre, activo, modelo, version_app, creado_en, revocado_en, ultima_senal_en
         FROM puente WHERE sucursal_id = $1 ORDER BY creado_en DESC, id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      activo: f.activo,
      modelo: f.modelo,
      versionApp: f.version_app,
      vinculadoEn: new Date(f.creado_en).toISOString(),
      revocadoEn: iso(f.revocado_en),
      ultimaSenalEn: iso(f.ultima_senal_en),
    }));
  }

  /**
   * `DELETE /sucursales/:sucursalId/puentes/:id` (criterio 108): revoca el puente (su token da 401 y su conexión se
   * cierra al confirmar). Un puente de otra sucursal, de otra empresa o inexistente es 404; revocar uno ya
   * revocado no cambia nada ni audita.
   */
  async revocar(sucursalId: string, id: string): Promise<void> {
    await this.exigirSucursal(sucursalId);
    const ahora = this.reloj.ahora();
    const revocados = await this.conexion.query<{ id: string }>(
      `UPDATE puente SET activo = false, revocado_en = $3, actualizado_en = $3
        WHERE id = $1 AND sucursal_id = $2 AND activo
        RETURNING id`,
      { bind: [id, sucursalId, ahora], type: QueryTypes.SELECT },
    );
    if (revocados.length === 0) {
      const existe = await this.conexion.query<{ id: string }>(
        'SELECT id FROM puente WHERE id = $1 AND sucursal_id = $2',
        { bind: [id, sucursalId], type: QueryTypes.SELECT },
      );
      if (existe.length === 0) throw noEncontrado('El puente');
      return;
    }
    await this.auditoria.registrar({
      accion: 'revocar_puente',
      sucursalId,
      entidad: 'puente',
      entidadId: id,
      detalle: { sucursalId, puenteId: id },
    });
    this.cerrarConexiones([id]);
  }

  // ---- El puente ----------------------------------------------------------------------------------

  /** `POST /puente/vinculacion` (criterio 107). */
  async vincular(
    vinculacion: VinculacionAutenticada,
    entrada: VincularPuenteEntrada,
  ): Promise<VincularPuenteRespuesta> {
    const { empresaId, sucursalId, vinculacionId, puenteIdNuevo } = vinculacion;
    const ahora = this.reloj.ahora();
    // Las vinculaciones de una sucursal se turnan: un puente activo, el anterior revocado antes de crear el nuevo.
    await this.conexion.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', {
      bind: [`puente:${sucursalId}`],
      type: QueryTypes.SELECT,
    });
    // Un solo uso: de dos peticiones a la vez gana exactamente una; la otra no encuentra la fila sin usar.
    const usadas = await this.conexion.query<{ creado_por_usuario_id: string | null }>(
      `UPDATE vinculacion_puente SET usada_en = $2, actualizado_en = $2
        WHERE id = $1 AND usada_en IS NULL AND invalidada_en IS NULL AND expira_en > $2
        RETURNING creado_por_usuario_id`,
      { bind: [vinculacionId, ahora], type: QueryTypes.SELECT },
    );
    if (usadas.length === 0) throw vinculacionInvalida();

    const revocados = await this.conexion.query<{ id: string }>(
      `UPDATE puente SET activo = false, revocado_en = $2, actualizado_en = $2
        WHERE sucursal_id = $1 AND activo
        RETURNING id`,
      { bind: [sucursalId, ahora], type: QueryTypes.SELECT },
    );
    const secreto = this.credenciales.generarSecreto();
    const nombre = (entrada.nombreEquipo ?? entrada.modelo ?? NOMBRE_POR_DEFECTO).slice(0, 60);
    await this.conexion.query(
      `INSERT INTO puente (id, empresa_id, sucursal_id, nombre, modelo, version_app, huella_secreto, activo,
                           estado_impresoras, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, '{}'::jsonb, $8, $8)`,
      {
        bind: [
          puenteIdNuevo,
          empresaId,
          sucursalId,
          nombre,
          entrada.modelo ?? null,
          entrada.versionApp,
          this.credenciales.huellaSecreto(secreto),
          ahora,
        ],
        type: QueryTypes.INSERT,
      },
    );
    await this.conexion.query(
      'UPDATE vinculacion_puente SET puente_id = $2, actualizado_en = $3 WHERE id = $1',
      { bind: [vinculacionId, puenteIdNuevo, ahora], type: QueryTypes.UPDATE },
    );
    await this.auditoria.registrar({
      accion: 'vincular_puente',
      sucursalId,
      entidad: 'puente',
      entidadId: puenteIdNuevo,
      detalle: {
        sucursalId,
        puenteId: puenteIdNuevo,
        vinculacionId,
        vinculacionCreadaPor: usadas[0]!.creado_por_usuario_id,
        reemplaza: revocados.map((r) => r.id),
      },
    });
    this.cerrarConexiones(revocados.map((r) => r.id));

    const [sucursal] = await this.sucursales.listar([sucursalId]);
    const puente = { id: puenteIdNuevo, nombre };
    return {
      token: armarTokenPuente(empresaId, puenteIdNuevo, secreto),
      puente,
      sucursal: { id: sucursalId, nombre: sucursal?.nombre ?? '' },
      configuracion: await this.configuracion({ empresaId, puenteId: puenteIdNuevo, sucursalId }),
    };
  }

  /** `GET /puente/configuracion` (criterio 110): las impresoras activas de la sucursal del puente. */
  async configuracion(puente: PuenteAutenticado): Promise<ConfiguracionPuente> {
    const [datos] = await this.conexion.query<{ nombre: string }>(
      'SELECT nombre FROM puente WHERE id = $1 AND sucursal_id = $2',
      { bind: [puente.puenteId, puente.sucursalId], type: QueryTypes.SELECT },
    );
    const [sucursal] = await this.sucursales.listar([puente.sucursalId]);
    const impresoras = await this.conexion.query<{
      id: string;
      nombre: string;
      conexion_tipo: 'RED' | 'BLUETOOTH';
      host: string | null;
      puerto: number | null;
      mac: string | null;
      ancho_mm: 58 | 80;
      juego_caracteres: ConfiguracionPuente['impresoras'][number]['juegoCaracteres'];
      gaveta: boolean;
    }>(
      `SELECT id, nombre, conexion_tipo, host, puerto, mac, ancho_mm, juego_caracteres, gaveta
         FROM impresora WHERE sucursal_id = $1 AND activa ORDER BY lower(nombre), id`,
      { bind: [puente.sucursalId], type: QueryTypes.SELECT },
    );
    return {
      puente: { id: puente.puenteId, nombre: datos?.nombre ?? '' },
      sucursal: { id: puente.sucursalId, nombre: sucursal?.nombre ?? '' },
      impresoras: impresoras.map((i) => ({
        id: i.id,
        nombre: i.nombre,
        conexion:
          i.conexion_tipo === 'RED'
            ? { tipo: 'RED' as const, host: i.host ?? '', puerto: i.puerto ?? 0 }
            : { tipo: 'BLUETOOTH' as const, mac: i.mac ?? '' },
        anchoMm: i.ancho_mm,
        juegoCaracteres: i.juego_caracteres,
        gaveta: i.gaveta,
      })),
    };
  }

  private cerrarConexiones(puenteIds: readonly string[]): void {
    if (puenteIds.length === 0) return;
    const empresaId = this.contexto.empresaActual();
    const ids = [...puenteIds];
    this.contexto.alConfirmar(async () => {
      for (const id of ids) await this.tiempoReal.desconectarPuente(empresaId, id);
    });
  }

  private async exigirSucursal(sucursalId: string): Promise<void> {
    if (!(await this.sucursales.existen([sucursalId]))) throw noEncontrado('La sucursal');
  }
}
