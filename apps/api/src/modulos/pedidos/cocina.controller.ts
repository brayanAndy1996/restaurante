import { Body, Controller, Get, Headers, Inject, Param, Put, Query, Res } from '@nestjs/common';
import {
  cocinaConsultaSchema,
  estadoLineaEntradaSchema,
  type CocinaRespuesta,
  type ComandaKds,
  type LineaKds,
} from '@restaurante/contratos';
import type { EstadoLineaElegible } from '@restaurante/dominio';
import type { Response } from 'express';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { coincideConEtag, etagDeVista } from '../../nucleo/http/etag';
import { Permiso, RequiereModulo } from '../seguridad';
import { CocinaService } from './cocina.service';

/**
 * Pantalla de cocina (KDS; historia 004, criterios 56 a 63). Las cuatro rutas llevan `USAR_KDS` y `COCINA`
 * (Cocina/Barra, Supervisor y Administrador; Mozo y Cajero, 403 `PROHIBIDO`) y trabajan con la sucursal activa.
 */
@Controller('cocina')
export class CocinaController {
  constructor(@Inject(CocinaService) private readonly cocina: CocinaService) {}

  /**
   * 200 `cocinaRespuesta` con `ETag` (304 con `If-None-Match` igual); 400 si `estacionIds` no son UUID; 403;
   * 409 `SUCURSAL_NO_ELEGIDA`. El `ETag` cubre todo menos `ahora`, que cambia en cada petición.
   */
  @Get('comandas')
  @RequiereModulo('COCINA')
  @Permiso('USAR_KDS')
  async comandas(
    @Query(new PipeZod(cocinaConsultaSchema)) consulta: { estacionIds: string[] },
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<CocinaRespuesta | undefined> {
    const { respuesta: vista, paraEtag } = await this.cocina.comandas(consulta.estacionIds);
    const etag = etagDeVista(paraEtag);
    respuesta.setHeader('ETag', etag);
    respuesta.setHeader('Cache-Control', 'private, no-cache');
    if (coincideConEtag(ifNoneMatch, etag)) {
      respuesta.status(304);
      return undefined;
    }
    return vista;
  }

  /**
   * 200 con la línea; 400; 403; 404 (línea de otra sucursal, de otra empresa o inexistente); 409
   * `TRANSICION_INVALIDA` (línea `ANULADO` o de una comanda de marcha o de anulación).
   */
  @Put('lineas/:id/estado')
  @RequiereModulo('COCINA')
  @Permiso('USAR_KDS')
  cambiarEstado(
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(estadoLineaEntradaSchema)) entrada: { estado: EstadoLineaElegible },
  ): Promise<LineaKds> {
    return this.cocina.cambiarEstado(id, entrada.estado);
  }

  /** 200 con la comanda; 403; 404; 409 `TRANSICION_INVALIDA` si no es una `COMANDA` o `ADICION`. */
  @Put('comandas/:id/listo')
  @RequiereModulo('COCINA')
  @Permiso('USAR_KDS')
  todoListo(@Param('id', PipeUuid) id: string): Promise<ComandaKds> {
    return this.cocina.todoListo(id);
  }

  /** 200 con la comanda; 403; 404; 409 `TRANSICION_INVALIDA` si no es una `MARCHAR` o `ANULACION`. */
  @Put('comandas/:id/visto')
  @RequiereModulo('COCINA')
  @Permiso('USAR_KDS')
  visto(@Param('id', PipeUuid) id: string): Promise<ComandaKds> {
    return this.cocina.visto(id);
  }
}
