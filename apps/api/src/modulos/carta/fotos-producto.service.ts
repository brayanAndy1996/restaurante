import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { FotoRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ALMACEN_ARCHIVOS, leerImagen, type AlmacenArchivos } from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
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
 * La subida al almacén ocurre dentro de la petición y antes de confirmar: si la operación lanza después
 * de guardar, el servicio borra el archivo nuevo; un `COMMIT` que falla deja el archivo huérfano (riesgo
 * aceptado del plan, "Fotos huérfanas").
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
  ) {}

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

    const anterior = await this.bloquearProducto(productoId);
    const empresaId = this.contexto.empresaActual();
    const clave = `carta/${empresaId}/${productoId.toLowerCase()}/${randomUUID()}.${imagen.extension}`;
    await this.almacen.guardar(clave, contenido, imagen.tipo);
    try {
      await this.conexion.query(
        'UPDATE producto SET foto_clave = $2, actualizado_en = $3 WHERE id = $1',
        {
          bind: [productoId, clave, this.reloj.ahora()],
        },
      );
      await this.auditoria.registrar({
        accion: 'cambiar_foto_producto',
        entidad: 'producto',
        entidadId: productoId,
        detalle: { claveAnterior: anterior, claveNueva: clave },
      });
    } catch (error) {
      await this.almacen.borrar(clave).catch(() => undefined);
      throw error;
    }
    this.borrarDespuesDeConfirmar(anterior, empresaId);
    this.eventos.cartaActualizada(null);
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
