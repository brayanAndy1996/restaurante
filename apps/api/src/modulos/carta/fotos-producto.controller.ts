import { Controller, Delete, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import type { FotoRespuesta } from '@restaurante/contratos';
import type { Request } from 'express';
import { leerCuerpoDeFoto } from '../../nucleo/archivos';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { PipeUuid } from '../../nucleo/errores/pipes';
import { Permiso } from '../seguridad';
import { FotosProductoService } from './fotos-producto.service';

/**
 * Foto de un producto (criterios 14 a 17): `EDITAR_CARTA`. El cuerpo binario (hasta 1 MB) lo lee el propio
 * controlador con `leerCuerpoDeFoto`, así que ocurre después del guard de autenticación y del permiso: sin
 * sesión (401) o sin permiso (403) no se lee ni un byte, aunque el cuerpo pase de 1 MB (criterio 61).
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
  async subir(@Param('id', PipeUuid) id: string, @Req() peticion: Request): Promise<FotoRespuesta> {
    const { datos, tipo } = await leerCuerpoDeFoto(peticion);
    return this.fotos.subir(id, datos, tipo);
  }

  /** 204 (también sin foto); 403; 404. */
  @Delete()
  @HttpCode(204)
  @Permiso('EDITAR_CARTA')
  quitar(@Param('id', PipeUuid) id: string): Promise<void> {
    return this.fotos.quitar(id);
  }
}
