import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { QrMesaRespuesta, QrMesasRespuesta } from '@restaurante/contratos';
import { PipeUuid } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';

/**
 * QR de las mesas (historia 005, criterios 7 a 9). FIRMAS: sin `@Permiso('ADMINISTRAR')` hasta la fase C (T5), que
 * también las conecta con `CodigosMesaService`.
 */
@Controller('sucursales/:sucursalId')
export class QrMesasController {
  /** 200 `qrMesasRespuesta`; 403; 404; 503 `CONFIGURACION_INCOMPLETA` sin `CARTA_WEB_URL`. */
  @Get('qr-mesas')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<QrMesasRespuesta> {
    void sucursalId;
    return Promise.reject(new Error('No implementado'));
  }

  /** 200 `qrMesasRespuesta` con los códigos que faltaban creados; 403; 404; 503. Repetirlo no cambia ningún código. */
  @Post('qr-mesas')
  @HttpCode(200)
  crearFaltantes(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<QrMesasRespuesta> {
    void sucursalId;
    return Promise.reject(new Error('No implementado'));
  }

  /**
   * 201 `qrMesaRespuesta` con un código nuevo, `Idempotency-Key` obligatoria; 403; 404; 409 `CONFLICTO` (mesa
   * inactiva); 503.
   */
  @Post('mesas/:mesaId/qr')
  @IdempotenteObligatoria()
  cambiar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('mesaId', PipeUuid) mesaId: string,
  ): Promise<QrMesaRespuesta> {
    void sucursalId;
    void mesaId;
    return Promise.reject(new Error('No implementado'));
  }
}
