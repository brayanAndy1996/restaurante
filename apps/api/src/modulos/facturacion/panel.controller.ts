import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  alertasConsultaSchema,
  panelConsultaSchema,
  reemisionEntradaSchema,
  type AlertasRespuesta,
  type ComprobanteDetalle,
  type EnlaceComprobanteRespuesta,
  type EnvioPseRespuesta,
  type PanelComprobantes,
  type PanelConsultaValidada,
  type ReemisionEntrada,
  type ReemisionRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { PanelService } from './panel.service';
import { ReemisionService } from './reemision.service';

/**
 * Panel de comprobantes, reintento, reemisión, PDF, enlace y alertas (historia 006, entrega 6b, criterios 132 a 135, 159
 * y 160). Fase A: las rutas están registradas **sin** `@Permiso('COBRAR')` ni `@RequiereModulo('FACTURACION')` (se agregan
 * en la fase C, T32 y T43) y responden `Error('No implementado')`. Ninguna cuelga de los prefijos de 6a (criterio 168).
 */
@Controller('facturacion')
export class PanelController {
  constructor(
    @Inject(PanelService) private readonly panel: PanelService,
    @Inject(ReemisionService) private readonly reemision: ReemisionService,
  ) {}

  /** 200 `panelComprobantes`; 400; 403; 404 (sucursal ajena). */
  @Get('comprobantes')
  listar(
    @Query(new PipeZod(panelConsultaSchema)) consulta: PanelConsultaValidada,
  ): Promise<PanelComprobantes> {
    return this.panel.listar(consulta);
  }

  /** 200 `comprobanteDetalle`; 403; 404. */
  @Get('comprobantes/:id')
  detalle(@Param('id', PipeUuid) id: string): Promise<ComprobanteDetalle> {
    return this.panel.detalle(id);
  }

  /** 202 `envioRespuesta`; 403; 404; 409 `ENVIO_TERMINADO`. */
  @Post('comprobantes/:id/reintento')
  @IdempotenteObligatoria()
  @HttpCode(202)
  reintentar(@Param('id', PipeUuid) id: string): Promise<EnvioPseRespuesta> {
    return this.panel.reintentar(id);
  }

  /** 201 `{ comprobante, impresion, trabajoId }`; 400; 403; 404; 409; 422. */
  @Post('comprobantes/:id/reemision')
  @IdempotenteObligatoria()
  reemitir(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(reemisionEntradaSchema)) entrada: ReemisionEntrada,
  ): Promise<ReemisionRespuesta> {
    return this.reemision.reemitir(id, entrada);
  }

  /** 200 `application/pdf`; 403; 404; 409 `PDF_NO_DISPONIBLE`. */
  @Get('comprobantes/:id/pdf')
  pdf(@Param('id', PipeUuid) id: string): Promise<StreamableFile> {
    return this.panel.pdf(id);
  }

  /** 200 `{ url, expiraEn }`; 403; 404; 409 `PDF_NO_DISPONIBLE`. */
  @Get('comprobantes/:id/enlace')
  enlace(@Param('id', PipeUuid) id: string): Promise<EnlaceComprobanteRespuesta> {
    return this.panel.enlace(id);
  }

  /** 200 `alertasRespuesta`; 403; 404. */
  @Get('alertas')
  alertas(
    @Query(new PipeZod(alertasConsultaSchema)) consulta: { sucursalId?: string },
  ): Promise<AlertasRespuesta> {
    return this.panel.alertas(consulta.sucursalId);
  }
}
