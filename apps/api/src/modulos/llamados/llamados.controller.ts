import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  atencionEntradaSchema,
  descarteEntradaSchema,
  pasoACuentaEntradaSchema,
  type AtencionEntrada,
  type AtencionRespuesta,
  type DescarteEntrada,
  type LlamadoDetalle,
  type LlamadosRespuesta,
  type PasoACuentaEntrada,
  type PasoACuentaRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { AtencionLlamadosService } from './atencion-llamados.service';
import { PasoACuentaService } from './paso-a-cuenta.service';
import { VistaLlamadosService } from './vista-llamados.service';

/**
 * Los llamados vistos por el mozo (historia 005, criterios 39 a 55). FIRMAS: sin `@Permiso('ATENDER_MESA')` ni
 * `@RequiereModulo('SALON')` hasta la fase C (T12), que también las implementa.
 */
@Controller('llamados')
export class LlamadosController {
  constructor(
    @Inject(VistaLlamadosService) private readonly vista: VistaLlamadosService,
    @Inject(AtencionLlamadosService) private readonly atencion: AtencionLlamadosService,
    @Inject(PasoACuentaService) private readonly paso: PasoACuentaService,
  ) {}

  /** 200 `llamadosRespuesta` con `ETag`; 304. */
  @Get()
  lista(): Promise<LlamadosRespuesta> {
    return this.vista.lista();
  }

  /** 200 `llamadoDetalle`; 404. */
  @Get(':id')
  detalle(@Param('id', PipeUuid) id: string): Promise<LlamadoDetalle> {
    return this.vista.detalle(id);
  }

  /**
   * 200 `atencionRespuesta`; 400; 404; 409 `MESA_LIBRE`, `LLAMADO_TOMADO`, `LLAMADO_VENCIDO`, `LLAMADO_CERRADO` o
   * `CONFLICTO`; 422 `REFERENCIA_INVALIDA`. `Idempotency-Key` obligatoria.
   */
  @Post(':id/atencion')
  @HttpCode(200)
  @IdempotenteObligatoria()
  atender(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(atencionEntradaSchema)) entrada: AtencionEntrada,
  ): Promise<AtencionRespuesta> {
    return this.atencion.atender(id, entrada);
  }

  /**
   * 200 `pasoACuentaRespuesta`; 400; 404; 409 `TRANSICION_INVALIDA`, `LLAMADO_CERRADO` o `MESA_SIN_CUENTA`; 422
   * `PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA`, `MONTO_FUERA_DE_RANGO` o `DATOS_INVALIDOS`. `Idempotency-Key`
   * obligatoria.
   */
  @Post(':id/paso-a-cuenta')
  @HttpCode(200)
  @IdempotenteObligatoria()
  pasarACuenta(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(pasoACuentaEntradaSchema)) entrada: PasoACuentaEntrada,
  ): Promise<PasoACuentaRespuesta> {
    return this.paso.pasar(id, entrada);
  }

  /** 200 `llamadoDetalle`; 400; 404; 409 `LLAMADO_CERRADO` o `LLAMADO_VENCIDO`. `Idempotency-Key` obligatoria. */
  @Post(':id/descarte')
  @HttpCode(200)
  @IdempotenteObligatoria()
  descartar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(descarteEntradaSchema)) entrada: DescarteEntrada,
  ): Promise<LlamadoDetalle> {
    return this.atencion.descartar(id, entrada);
  }
}
