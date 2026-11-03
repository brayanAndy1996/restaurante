import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LogoCartaWebRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ALMACEN_ARCHIVOS, leerImagen, type AlmacenArchivos } from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SesionActual, actorDePrincipal } from '../seguridad';
import { cartaWebSinConfigurar, logoInvalido } from './errores-carta-web';

/** Lados permitidos del logo, en píxeles (criterio 3). */
export const LADO_MINIMO_LOGO = 64;
export const LADO_MAXIMO_LOGO = 2048;

/**
 * Logo de la carta web (historia 005, criterio 3): una por empresa, con las reglas de la foto de un producto de 003
 * (JPEG, PNG o WebP reales, hasta 1 MB, tipo declarado igual al real) y de 64 a 2048 píxeles por lado. La clave en
 * el almacén de archivos es `carta-web/<empresa>/<uuid>.<ext>`, que arma la API con la empresa del contexto y un
 * UUID nuevo (nunca con datos del cuerpo). Reemplazar el logo crea una clave nueva y el archivo anterior se borra
 * después de confirmar.
 *
 * Como la foto del producto, la subida **no** retiene una conexión del pool (RNF-03): la ruta es `@SinEmpresa()` y
 * `subir` abre dos transacciones cortas, una antes y otra después de subir el archivo: (1) confirma que la empresa
 * tiene su carta web (409 `CARTA_WEB_SIN_CONFIGURAR`); (2) sube el archivo fuera de toda transacción; (3) fija la
 * clave nueva, audita y programa con `alConfirmar` el borrado de la anterior. Si el paso 3 falla, borra el archivo
 * recién subido (compensación).
 */
@Injectable()
export class LogoCartaWebService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  private readonly logger = new Logger(LogoCartaWebService.name);

  /** `PUT /carta-web/logo`: valida el archivo por su contenido, lo guarda y apunta la carta web a él. */
  async subir(datos: Buffer, tipoDeclarado: string): Promise<LogoCartaWebRespuesta> {
    const imagen = leerImagen(datos);
    if (imagen === null) {
      throw logoInvalido('El archivo no es una imagen JPEG, PNG o WebP completa. Elige otro logo');
    }
    if (imagen.tipo !== tipoDeclarado) {
      throw logoInvalido('El contenido del archivo no coincide con su tipo. Elige otro logo');
    }
    const menor = Math.min(imagen.ancho, imagen.alto);
    const mayor = Math.max(imagen.ancho, imagen.alto);
    if (menor < LADO_MINIMO_LOGO || mayor > LADO_MAXIMO_LOGO) {
      throw logoInvalido(
        `El logo debe medir entre ${LADO_MINIMO_LOGO} y ${LADO_MAXIMO_LOGO} píxeles por lado. Elige otro logo`,
      );
    }

    const principal = this.sesion.principal();
    const empresaId = principal.empresaId.toLowerCase();

    // 1. Transacción corta: la empresa ya tiene su carta web. La conexión se devuelve al pool.
    await this.enTransaccionCorta(async () => {
      const filas = await this.conexion.query<{ id: string }>('SELECT id FROM carta_web', {
        type: QueryTypes.SELECT,
      });
      if (filas[0] === undefined) throw cartaWebSinConfigurar();
    });

    // 2. La subida, fuera de toda transacción: no hay conexión tomada mientras dura.
    const clave = `carta-web/${empresaId}/${randomUUID()}.${imagen.extension}`;
    await this.almacen.guardar(clave, datos, imagen.tipo);

    // 3. Transacción corta: fija la clave, audita y programa el borrado de la anterior.
    try {
      await this.enTransaccionCorta(async () => {
        const actual = await this.bloquear();
        if (actual === undefined) throw cartaWebSinConfigurar();
        await this.conexion.query(
          'UPDATE carta_web SET logo_clave = $2, actualizado_en = $3 WHERE id = $1',
          { bind: [actual.id, clave, this.reloj.ahora()] },
        );
        await this.auditoria.registrar({
          accion: 'cambiar_logo_carta_web',
          entidad: 'carta_web',
          entidadId: actual.id,
          detalle: { claveAnterior: actual.logoClave, claveNueva: clave },
        });
        this.borrarDespuesDeConfirmar(actual.logoClave, empresaId);
      });
    } catch (error) {
      await this.compensar(clave);
      throw error;
    }
    return { logoUrl: this.almacen.urlPublica(clave) };
  }

  /** `DELETE /carta-web/logo`: quita el logo; sin logo (o sin carta web), no hace nada (ni auditoría). */
  async quitar(): Promise<void> {
    const actual = await this.bloquear();
    if (actual === undefined || actual.logoClave === null) return;
    const empresaId = this.contexto.empresaActual();
    await this.conexion.query(
      'UPDATE carta_web SET logo_clave = NULL, actualizado_en = $2 WHERE id = $1',
      { bind: [actual.id, this.reloj.ahora()] },
    );
    await this.auditoria.registrar({
      accion: 'quitar_logo_carta_web',
      entidad: 'carta_web',
      entidadId: actual.id,
      detalle: { claveAnterior: actual.logoClave },
    });
    this.borrarDespuesDeConfirmar(actual.logoClave, empresaId);
  }

  /** Corre `fn` en una transacción corta de la empresa de la sesión, con su actor (la ruta es `@SinEmpresa()`). */
  private enTransaccionCorta<T>(fn: () => Promise<T>): Promise<T> {
    const principal = this.sesion.principal();
    const actor = actorDePrincipal(principal);
    return this.contexto.ejecutar(principal.empresaId, fn, actor === null ? {} : { actor });
  }

  /** Bloquea la configuración de la empresa y devuelve la clave de su logo actual; `undefined` si no hay. */
  private async bloquear(): Promise<{ id: string; logoClave: string | null } | undefined> {
    const filas = await this.conexion.query<{ id: string; logo_clave: string | null }>(
      'SELECT id, logo_clave FROM carta_web FOR UPDATE',
      { type: QueryTypes.SELECT },
    );
    return filas[0] === undefined ? undefined : { id: filas[0].id, logoClave: filas[0].logo_clave };
  }

  /** Borra el archivo recién subido que no quedó apuntado por ninguna carta; si falla, solo lo registra. */
  private async compensar(clave: string): Promise<void> {
    try {
      await this.almacen.borrar(clave);
    } catch (error) {
      this.logger.error(
        `No se pudo borrar el logo recién subido ${clave} tras una falla; queda huérfano`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Borra la clave anterior después de confirmar. Solo borra claves que están bajo el prefijo de la propia
   * empresa: nunca un archivo de otra empresa, aunque la fila guardara otra cosa.
   */
  private borrarDespuesDeConfirmar(clave: string | null, empresaId: string): void {
    if (clave === null || !clave.startsWith(`carta-web/${empresaId}/`)) return;
    this.contexto.alConfirmar(() => this.almacen.borrar(clave));
  }
}
