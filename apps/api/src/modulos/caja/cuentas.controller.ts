import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import {
  cobroEntradaSchema,
  type CobroEntradaValidada,
  type CobroRespuesta,
  type CuentaRespuesta,
  type CuentaResumen,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { CobrosService } from './cobros.service';

/**
 * La cuenta y el cobro (historia 006, criterios 36, 37 y 47). FIRMAS de la fase A: sin `@Permiso`,
 * `@RequiereModulo` ni idempotencia todavía. En la fase C: `GET /cuentas` con `COBRAR` y `CAJA` (con `ETag` y 304),
 * `GET /cuentas/:ordenId` con `ATENDER_MESA` y `CAJA`, y el cobro con `COBRAR`, `CAJA` e `Idempotency-Key`.
 */
@Controller('cuentas')
export class CuentasController {
  constructor(@Inject(CobrosService) private readonly cobros: CobrosService) {}

  /** 200 `cuentaResumen[]` (de la más antigua a la más nueva); 304; 403. */
  @Get()
  porCobrar(): Promise<CuentaResumen[]> {
    return this.cobros.cuentasPorCobrar();
  }

  /** 200 `cuentaRespuesta`; 403; 404 (de otra sucursal, de otra empresa o inexistente). */
  @Get(':ordenId')
  cuenta(@Param('ordenId', PipeUuid) ordenId: string): Promise<CuentaRespuesta> {
    return this.cobros.cuenta(ordenId);
  }

  /**
   * 201 `cobroRespuesta`; 400; 403; 404; 409 `TURNO_CERRADO` / `TURNO_AJENO` / `CUENTA_CAMBIO` /
   * `ORDEN_NO_ABIERTA` / `NADA_QUE_COBRAR` / `SIN_SERIE` / `SERIE_AGOTADA` / `TASA_IGV_NO_CONFIGURADA`; 422
   * `PARTE_INVALIDA` / `PAGOS_NO_CUADRAN` / `COMPROBANTE_NO_PERMITIDO` / `CLIENTE_REQUERIDO` /
   * `MONTO_FUERA_DE_RANGO` / `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  @Post(':ordenId/cobros')
  cobrar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Body(new PipeZod(cobroEntradaSchema)) entrada: CobroEntradaValidada,
  ): Promise<CobroRespuesta> {
    return this.cobros.cobrar(ordenId, entrada);
  }
}
