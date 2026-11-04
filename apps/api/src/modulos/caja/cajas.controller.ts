import { Body, Controller, Get, Inject, Param, Patch, Post, Put } from '@nestjs/common';
import {
  cajaEntradaSchema,
  cajaModificarEntradaSchema,
  serieEntradaSchema,
  tipoSerieSchema,
  type CajaEntrada,
  type CajaModificarEntrada,
  type CajaRespuesta,
  type SerieEntrada,
} from '@restaurante/contratos';
import type { TipoComprobante } from '@restaurante/dominio';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { SeriesService } from '../facturacion';
import { CajasService } from './cajas.service';

/**
 * Cajas y series (historia 006, criterios 1 a 7) y la lista de cajas para abrir turno (criterio 27). FIRMAS de la
 * fase A: sin `@Permiso` ni `@RequiereModulo` todavía. En la fase C, las de configuración llevan
 * `@Permiso('ADMINISTRAR')` sin módulo y `GET /cajas`, `OPERAR_CAJA` y `CAJA`.
 */
@Controller()
export class CajasController {
  constructor(
    @Inject(CajasService) private readonly cajas: CajasService,
    @Inject(SeriesService) private readonly series: SeriesService,
  ) {}

  /** 200 `cajaRespuesta[]`; 403; 404 (sucursal de otra empresa o inexistente). */
  @Get('sucursales/:sucursalId/cajas')
  listar(@Param('sucursalId', PipeUuid) sucursalId: string): Promise<CajaRespuesta[]> {
    return this.cajas.listar(sucursalId);
  }

  /** 201 `cajaRespuesta`; 400; 403; 404; 409 `CONFLICTO` (nombre repetido o más de 10 activas); 422. */
  @Post('sucursales/:sucursalId/cajas')
  crear(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(cajaEntradaSchema)) entrada: CajaEntrada,
  ): Promise<CajaRespuesta> {
    return this.cajas.crear(sucursalId, entrada);
  }

  /** 200; 400; 403; 404; 409 `CONFLICTO` / `EN_USO` (caja con turno abierto); 422. */
  @Patch('sucursales/:sucursalId/cajas/:id')
  modificar(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('id', PipeUuid) id: string,
    @Body(new PipeZod(cajaModificarEntradaSchema)) entrada: CajaModificarEntrada,
  ): Promise<CajaRespuesta> {
    return this.cajas.modificar(sucursalId, id, entrada);
  }

  /**
   * 200 `cajaRespuesta`; 400 (la serie no es `B…` para `BOLETA` ni `F…` para `FACTURA`); 403; 404; 409
   * `CONFLICTO` (serie de otra caja del emisor, o `primerNumero` distinto al reactivar).
   */
  @Put('sucursales/:sucursalId/cajas/:cajaId/series/:tipo')
  async configurarSerie(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Param('cajaId', PipeUuid) cajaId: string,
    @Param('tipo', new PipeZod(tipoSerieSchema)) tipo: TipoComprobante,
    @Body(new PipeZod(serieEntradaSchema)) entrada: SerieEntrada,
  ): Promise<CajaRespuesta> {
    await this.series.configurar({ sucursalId, cajaId, tipo, entrada });
    return this.cajas.obtener(sucursalId, cajaId);
  }

  /** 200 `cajaRespuesta[]` (las activas de la sucursal activa, sin montos); 403. */
  @Get('cajas')
  activas(): Promise<CajaRespuesta[]> {
    return this.cajas.activasDeLaSucursal();
  }
}
