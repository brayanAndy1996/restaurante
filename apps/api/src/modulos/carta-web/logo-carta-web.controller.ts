import { Controller, Delete, HttpCode, Inject, Put, Req } from '@nestjs/common';
import type { LogoCartaWebRespuesta } from '@restaurante/contratos';
import type { Request } from 'express';
import { leerCuerpoDeFoto } from '../../nucleo/archivos';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { Permiso } from '../seguridad';
import { LogoCartaWebService } from './logo-carta-web.service';

/**
 * Logo de la carta web (historia 005, criterio 3): `ADMINISTRAR`, sin sucursal activa. `PUT` es `@SinEmpresa()` como
 * la foto de un producto de 003 (el interceptor global no abre la transacción de la petición: el servicio abre dos
 * transacciones cortas alrededor de la subida). El cuerpo binario (hasta 1 MB) lo lee el propio controlador con
 * `leerCuerpoDeFoto`, así que ocurre después de la autenticación y del permiso: sin sesión (401) o sin permiso (403)
 * no se lee ni un byte.
 */
@Controller('carta-web/logo')
export class LogoCartaWebController {
  constructor(@Inject(LogoCartaWebService) private readonly logo: LogoCartaWebService) {}

  /** 200 `{ logoUrl }`; 403; 409 `CARTA_WEB_SIN_CONFIGURAR`; 413; 415; 422 `FOTO_INVALIDA`. */
  @Put()
  @SinEmpresa()
  @Permiso('ADMINISTRAR')
  async subir(@Req() peticion: Request): Promise<LogoCartaWebRespuesta> {
    const { datos, tipo } = await leerCuerpoDeFoto(peticion);
    return this.logo.subir(datos, tipo);
  }

  /** 204 (también sin logo); 403. */
  @Delete()
  @HttpCode(204)
  @Permiso('ADMINISTRAR')
  quitar(): Promise<void> {
    return this.logo.quitar();
  }
}
