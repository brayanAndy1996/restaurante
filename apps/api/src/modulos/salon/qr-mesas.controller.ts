import { Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { QrMesaRespuesta, QrMesasRespuesta } from '@restaurante/contratos';
import { PipeUuid } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { QrMesasService } from './qr-mesas.service';

/**
 * QR de las mesas (historia 005, criterios 7 a 9): `ADMINISTRAR` en las tres, con la sucursal en la ruta y sin
 * `@RequiereModulo` (son de configuración, como el mapa de mesas de 004).
 */
@Controller('sucursales/:sucursalId')
export class QrMesasController {
  constructor(@Inject(QrMesasService) private readonly qr: QrMesasService) {}

  /** 200 `qrMesasRespuesta`; 403; 404; 503 `CONFIGURACION_INCOMPLETA` sin `CARTA_WEB_URL`. */
  @Get('qr-mesas')
  @Permiso('ADMINISTRAR')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<QrMesasRespuesta> {
    return this.qr.listar(sucursalId);
  }

  /** 200 `qrMesasRespuesta` con los códigos que faltaban creados; 403; 404; 503. Repetirlo no cambia ningún código. */
  @Post('qr-mesas')
  @HttpCode(200)
  @Permiso('ADMINISTRAR')
  crearFaltantes(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<QrMesasRespuesta> {
    return this.qr.crearFaltantes(sucursalId);
  }

  /**
   * 201 `qrMesaRespuesta` con un código nuevo, `Idempotency-Key` obligatoria; 403; 404; 409 `CONFLICTO` (mesa
   * inactiva); 503.
   */
  @Post('mesas/:mesaId/qr')
  @IdempotenteObligatoria()
  @Permiso('ADMINISTRAR')
  cambiar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('mesaId', PipeUuid) mesaId: string,
  ): Promise<QrMesaRespuesta> {
    return this.qr.cambiar(sucursalId, mesaId);
  }
}
