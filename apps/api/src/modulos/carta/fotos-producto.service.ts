import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FotoRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ALMACEN_ARCHIVOS, leerImagen, type AlmacenArchivos } from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SesionActual, actorDePrincipal } from '../seguridad';
import { fotoInvalida, noEncontrado } from './errores-carta';
import { EventosCarta } from './eventos-carta';

/** Lados permitidos de una foto, en píxeles (criterio 14). */
export const LADO_MINIMO_FOTO = 200;
export const LADO_MAXIMO_FOTO = 2048;

/**
 * Foto de un producto (RF-14, criterios 14 a 17): una por producto, en el almacén de archivos bajo la clave
 * `carta/<empresa>/<producto>/<uuid>.<ext>`, que arma la API con la empresa del contexto y un UUID nuevo
 * (nunca con datos del cuerpo). Reemplazar la foto crea una clave nueva y el archivo anterior se borra
 * después de confirmar la transacción: si no se confirma, el producto conserva su foto y el archivo
 * anterior sigue en el almacén.
 *
 * La subida al almacén (hasta 20 s con R2) **no** retiene una conexión del pool (RNF-03: agotar el pool
 * afectaría a todas las empresas). La ruta es `@SinEmpresa()` y `subir` abre dos transacciones cortas, una
 * antes y otra después de subir: (1) confirma que el producto existe y es de la empresa (404); (2) sube el
 * archivo nuevo fuera de toda transacción; (3) fija la clave nueva, audita y programa con `alConfirmar` el
 * borrado de la anterior. Si el paso 3 falla o el producto ya no existe, borra el archivo recién subido
 * (compensación; si eso también falla solo se registra). Un archivo puede quedar huérfano solo si el
 * proceso muere entre la subida y la confirmación (riesgo aceptado del plan, "Fotos huérfanas").
 */
@Injectable()
export class FotosProductoService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  private readonly logger = new Logger(FotosProductoService.name);

  /**
   * Criterio 14: valida el archivo por su contenido, guarda la foto nueva y apunta el producto a ella.
   * `tipoDeclarado` es el `Content-Type` de la petición: debe coincidir con el formato real.
   */
  async subir(
    productoId: string,
    contenido: Buffer,
    tipoDeclarado: string,
  ): Promise<FotoRespuesta> {
    const imagen = leerImagen(contenido);
    if (imagen === null) {
      throw fotoInvalida('El archivo no es una imagen JPEG, PNG o WebP completa. Elige otra foto');
    }
    if (imagen.tipo !== tipoDeclarado) {
      throw fotoInvalida('El contenido del archivo no coincide con su tipo. Elige otra foto');
    }
    const menor = Math.min(imagen.ancho, imagen.alto);
    const mayor = Math.max(imagen.ancho, imagen.alto);
    if (menor < LADO_MINIMO_FOTO || mayor > LADO_MAXIMO_FOTO) {
      throw fotoInvalida(
        `La foto debe medir entre ${LADO_MINIMO_FOTO} y ${LADO_MAXIMO_FOTO} píxeles por lado. Elige otra foto`,
      );
    }

    const principal = this.sesion.principal();
    const empresaId = principal.empresaId.toLowerCase();

    // 1. Transacción corta: el producto existe y es de la empresa (404). La conexión se devuelve al pool.
    await this.enTransaccionCorta(async () => {
      const filas = await this.conexion.query<{ id: string }>(
        'SELECT id FROM producto WHERE id = $1',
        { bind: [productoId], type: QueryTypes.SELECT },
      );
      if (filas[0] === undefined) throw noEncontrado('El producto');
    });

    // 2. La subida, fuera de toda transacción: no hay conexión tomada mientras dura.
    const clave = `carta/${empresaId}/${productoId.toLowerCase()}/${randomUUID()}.${imagen.extension}`;
    await this.almacen.guardar(clave, contenido, imagen.tipo);

    // 3. Transacción corta: fija la clave, audita y programa el borrado de la anterior.
    try {
      await this.enTransaccionCorta(async () => {
        const anterior = await this.bloquearProducto(productoId);
        await this.conexion.query(
          'UPDATE producto SET foto_clave = $2, actualizado_en = $3 WHERE id = $1',
          { bind: [productoId, clave, this.reloj.ahora()] },
        );
        await this.auditoria.registrar({
          accion: 'cambiar_foto_producto',
          entidad: 'producto',
          entidadId: productoId,
          detalle: { claveAnterior: anterior, claveNueva: clave },
        });
        this.borrarDespuesDeConfirmar(anterior, empresaId);
        this.eventos.cartaActualizada(null);
      });
    } catch (error) {
      await this.compensar(clave);
      throw error;
    }
    return { fotoUrl: this.almacen.urlPublica(clave) };
  }

  /** Criterio 16: quita la foto; sin foto, no hace nada (ni auditoría ni evento). */
  async quitar(productoId: string): Promise<void> {
    const anterior = await this.bloquearProducto(productoId);
    if (anterior === null) return;
    const empresaId = this.contexto.empresaActual();
    await this.conexion.query(
      'UPDATE producto SET foto_clave = NULL, actualizado_en = $2 WHERE id = $1',
      {
        bind: [productoId, this.reloj.ahora()],
      },
    );
    await this.auditoria.registrar({
      accion: 'quitar_foto_producto',
      entidad: 'producto',
      entidadId: productoId,
      detalle: { claveAnterior: anterior },
    });
    this.borrarDespuesDeConfirmar(anterior, empresaId);
    this.eventos.cartaActualizada(null);
  }

  /** Corre `fn` en una transacción corta de la empresa de la sesión, con su actor (la ruta es `@SinEmpresa()`). */
  private enTransaccionCorta<T>(fn: () => Promise<T>): Promise<T> {
    const principal = this.sesion.principal();
    const actor = actorDePrincipal(principal);
    return this.contexto.ejecutar(principal.empresaId, fn, actor === null ? {} : { actor });
  }

  /** Borra el archivo recién subido que no quedó apuntado por ningún producto; si falla, solo lo registra. */
  private async compensar(clave: string): Promise<void> {
    try {
      await this.almacen.borrar(clave);
    } catch (error) {
      this.logger.error(
        `No se pudo borrar la foto recién subida ${clave} tras una falla; queda huérfana`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Bloquea el producto (404 si no es de la empresa) y devuelve la clave de su foto actual. */
  private async bloquearProducto(productoId: string): Promise<string | null> {
    const filas = await this.conexion.query<{ foto_clave: string | null }>(
      'SELECT foto_clave FROM producto WHERE id = $1 FOR UPDATE',
      { bind: [productoId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw noEncontrado('El producto');
    return filas[0].foto_clave;
  }

  /**
   * Borra la clave anterior después de confirmar. Solo borra claves que están bajo el prefijo de la propia
   * empresa: nunca un archivo de otra empresa (criterio 68), aunque la fila guardara otra cosa.
   */
  private borrarDespuesDeConfirmar(clave: string | null, empresaId: string): void {
    if (clave === null || !clave.startsWith(`carta/${empresaId}/`)) return;
    this.contexto.alConfirmar(() => this.almacen.borrar(clave));
  }
}
