import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import {
  cobroEntradaSchema,
  type CobroEntradaValidada,
  type CobroRespuesta,
  type CuentaRespuesta,
  type CuentaResumen,
} from '@restaurante/contratos';
import type { Response } from 'express';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { coincideConEtag, etagDeVista } from '../../nucleo/http/etag';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { CobrosService } from './cobros.service';

/**
 * La cuenta y el cobro (historia 006, criterios 36, 37 y 47): `GET /cuentas` con `COBRAR` y `CAJA` (con `ETag` y 304),
 * `GET /cuentas/:ordenId` con `ATENDER_MESA` y `CAJA`, y el cobro con `COBRAR`, `CAJA` e `Idempotency-Key`.
 */
@Controller('cuentas')
export class CuentasController {
  constructor(@Inject(CobrosService) private readonly cobros: CobrosService) {}

  /** 200 `cuentaResumen[]` (de la más antigua a la más nueva) con `ETag`; 304; 403. */
  @Get()
  @RequiereModulo('CAJA')
  @Permiso('COBRAR')
  async porCobrar(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<CuentaResumen[] | undefined> {
    const vista = await this.cobros.cuentasPorCobrar();
    const etag = etagDeVista(vista);
    respuesta.setHeader('ETag', etag);
    respuesta.setHeader('Cache-Control', 'private, no-cache');
    if (coincideConEtag(ifNoneMatch, etag)) {
      respuesta.status(304);
      return undefined;
    }
    return vista;
  }

  /** 200 `cuentaRespuesta`; 403; 404 (de otra sucursal, de otra empresa o inexistente). */
  @Get(':ordenId')
  @RequiereModulo('CAJA')
  @Permiso('ATENDER_MESA')
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
  @IdempotenteObligatoria()
  @RequiereModulo('CAJA')
  @Permiso('COBRAR')
  cobrar(
    @Param('ordenId', PipeUuid) ordenId: string,
    @Body(new PipeZod(cobroEntradaSchema)) entrada: CobroEntradaValidada,
  ): Promise<CobroRespuesta> {
    return this.cobros.cobrar(ordenId, entrada);
  }
}
