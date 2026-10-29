import { Controller, Get, Headers, Inject, Query, Res } from '@nestjs/common';
import {
  stockSalonConsultaSchema,
  type SalonRespuesta,
  type StockSalonRespuesta,
} from '@restaurante/contratos';
import type { Response } from 'express';
import { PipeZod } from '../../nucleo/errores/pipes';
import { coincideConEtag, etagDeVista } from '../../nucleo/http/etag';
import { Permiso, RequiereModulo } from '../seguridad';
import { SalonService } from './salon.service';

/**
 * El mapa del salón con estados y el stock del comandero (historia 004, criterios 7 y 73). Ambas rutas llevan
 * `ATENDER_MESA` y `SALON`.
 */
@Controller('salon')
export class SalonController {
  constructor(@Inject(SalonService) private readonly salon: SalonService) {}

  /**
   * 200 `salonRespuesta` con `ETag`; 304 con `If-None-Match` igual; 403; 409 `SUCURSAL_NO_ELEGIDA`. El `ETag`
   * cubre todo menos `ahora` (que cambia en cada petición); es una respuesta con sesión, así que la guarda el
   * navegador pero la revalida cada vez, como la carta.
   */
  @Get()
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  async mapa(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<SalonRespuesta | undefined> {
    const { respuesta: vista, paraEtag } = await this.salon.mapa();
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
   * 200 `{ productos: [{ productoId, disponible }] }` con lo que responde el puerto de inventario; 400 si
   * `productoIds` no son UUID; 403; 409 `SUCURSAL_NO_ELEGIDA`. Con `InventarioNulo`, siempre `{ productos: [] }`.
   */
  @Get('stock')
  @RequiereModulo('SALON')
  @Permiso('ATENDER_MESA')
  stock(
    @Query(new PipeZod(stockSalonConsultaSchema)) consulta: { productoIds: string[] },
  ): Promise<StockSalonRespuesta> {
    return this.salon.stock(consulta);
  }
}
