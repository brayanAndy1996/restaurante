import { Controller, Delete, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import type { FotoRespuesta } from '@restaurante/contratos';
import type { Request } from 'express';
import { TIPOS_DE_IMAGEN } from '../../nucleo/archivos';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { PipeUuid } from '../../nucleo/errores/pipes';
import { Permiso } from '../seguridad';
import { FotosProductoService } from './fotos-producto.service';

const tipoNoSoportado = () =>
  new ErrorAplicacion(
    415,
    'TIPO_NO_SOPORTADO',
    'La foto debe enviarse como image/jpeg, image/png o image/webp',
  );

/**
 * Foto de un producto (criterios 14 a 17): `EDITAR_CARTA`. El cuerpo binario (hasta 1 MB) lo lee
 * `analizadorBinarioDeFoto`, solo para esta ruta, y llega aquí como `Buffer`.
 */
@Controller('carta/productos/:id/foto')
export class FotosProductoController {
  constructor(@Inject(FotosProductoService) private readonly fotos: FotosProductoService) {}

  /**
   * 200 `{ fotoUrl }`; 403; 404; 413; 415; 422 `FOTO_INVALIDA`. `@SinEmpresa()`: el interceptor global no abre
   * la transacción de la petición (retendría una conexión durante la subida a R2, RNF-03); el servicio abre dos
   * transacciones cortas, antes y después de subir el archivo.
   */
  @Put()
  @SinEmpresa()
  @Permiso('EDITAR_CARTA')
  subir(@Param('id', PipeUuid) id: string, @Req() peticion: Request): Promise<FotoRespuesta> {
    const tipo = (peticion.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(TIPOS_DE_IMAGEN as readonly string[]).includes(tipo) || !Buffer.isBuffer(peticion.body)) {
      throw tipoNoSoportado();
    }
    return this.fotos.subir(id, peticion.body, tipo);
  }

  /** 204 (también sin foto); 403; 404. */
  @Delete()
  @HttpCode(204)
  @Permiso('EDITAR_CARTA')
  quitar(@Param('id', PipeUuid) id: string): Promise<void> {
    return this.fotos.quitar(id);
  }
}
