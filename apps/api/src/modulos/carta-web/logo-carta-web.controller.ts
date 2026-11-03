import { Controller, Delete, HttpCode, Inject, Put } from '@nestjs/common';
import type { LogoCartaWebRespuesta } from '@restaurante/contratos';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { LogoCartaWebService } from './logo-carta-web.service';

/**
 * Logo de la carta web (historia 005, criterio 3). `PUT` es `@SinEmpresa()` como la foto de un producto de 003: el
 * servicio abre dos transacciones cortas alrededor de la subida. FIRMAS: sin `@Permiso('ADMINISTRAR')` ni lectura
 * del cuerpo binario hasta la fase C (T5).
 */
@Controller('carta-web/logo')
export class LogoCartaWebController {
  constructor(@Inject(LogoCartaWebService) private readonly logo: LogoCartaWebService) {}

  /** 200 `{ logoUrl }`; 403; 409 `CARTA_WEB_SIN_CONFIGURAR`; 413; 415; 422 `FOTO_INVALIDA`. */
  @Put()
  @SinEmpresa()
  subir(): Promise<LogoCartaWebRespuesta> {
    return this.logo.subir(Buffer.alloc(0), '');
  }

  /** 204 (también sin logo); 403. */
  @Delete()
  @HttpCode(204)
  quitar(): Promise<void> {
    return this.logo.quitar();
  }
}
