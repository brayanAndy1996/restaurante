import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
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
import type { Response } from 'express';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { coincideConEtag, etagDeVista } from '../../nucleo/http/etag';
import { IdempotenteObligatoria } from '../../nucleo/idempotencia';
import { Permiso, RequiereModulo } from '../seguridad';
import { AtencionLlamadosService } from './atencion-llamados.service';
import { PasoACuentaService } from './paso-a-cuenta.service';
import { VistaLlamadosService } from './vista-llamados.service';

/**
 * Los llamados vistos por el mozo (historia 005, criterios 39 a 55). Todas las rutas llevan `ATENDER_MESA` y el módulo
 * `SALON`; las escrituras, además, `Idempotency-Key` obligatoria. Orden de los rechazos: 401, 403 de rol, 409
 * `SUCURSAL_NO_ELEGIDA`, 403 `MODULO_NO_INCLUIDO`, 400 de forma (incluida la falta de la clave), réplica de la misma
 * clave, 404, réplica natural del llamado, 409 de estado y 422.
 */
@Controller('llamados')
export class LlamadosController {
  constructor(
    @Inject(VistaLlamadosService) private readonly vista: VistaLlamadosService,
    @Inject(AtencionLlamadosService) private readonly atencion: AtencionLlamadosService,
    @Inject(PasoACuentaService) private readonly paso: PasoACuentaService,
  ) {}

  /**
   * 200 `llamadosRespuesta` con `ETag`; 304 con `If-None-Match` igual. El `ETag` cubre todo menos `ahora` (que cambia en
   * cada petición); es una respuesta con sesión: el navegador la guarda pero la revalida cada vez.
   */
  @Get()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  async lista(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<LlamadosRespuesta | undefined> {
    const { respuesta: cuerpo, paraEtag } = await this.vista.lista();
    const etag = etagDeVista(paraEtag);
    respuesta.setHeader('ETag', etag);
    respuesta.setHeader('Cache-Control', 'private, no-cache');
    if (coincideConEtag(ifNoneMatch, etag)) {
      respuesta.status(304);
      return undefined;
    }
    return cuerpo;
  }

  /** 200 `llamadoDetalle`; 404. */
  @Get(':id')
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
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
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
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
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
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
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  descartar(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(descarteEntradaSchema)) entrada: DescarteEntrada,
  ): Promise<LlamadoDetalle> {
    return this.atencion.descartar(id, entrada);
  }
}
