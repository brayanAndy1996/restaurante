import { Controller, Get, Headers, Inject, Res } from '@nestjs/common';
import type { CartaSucursalRespuesta } from '@restaurante/contratos';
import type { Response } from 'express';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { RequiereSucursal, SesionActual } from '../seguridad';
import { CartaVentaService } from './carta-venta.service';
import { coincideConEtag, etagDeVista } from './etag-carta';
import { noEncontrado } from './errores-carta';

/**
 * Vista de la carta de la sucursal activa, con `ETag` (criterios 47 a 50): cualquier rol con sucursal activa,
 * sin `@Permiso` (409 `SUCURSAL_NO_ELEGIDA` sin ella). La respuesta lleva un `ETag` fuerte calculado sobre su
 * contenido; con `If-None-Match` igual responde 304 sin cuerpo. El `ETag` ahorra red, no consultas: se
 * calcula armando la vista completa.
 */
@Controller('carta/sucursal')
export class VistaSucursalController {
  constructor(
    @Inject(CartaVentaService) private readonly carta: CartaVentaService,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** 200 `cartaSucursalRespuesta` con `ETag`; 304; 409 `SUCURSAL_NO_ELEGIDA`. */
  @Get()
  @RequiereSucursal()
  async vista(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<CartaSucursalRespuesta | undefined> {
    const sucursalId = this.sesion.principal().sucursalId;
    if (sucursalId === null) throw noEncontrado('La sucursal');
    const vista = await this.carta.cartaDeSucursal(sucursalId, this.reloj.ahora());
    const etag = etagDeVista(vista);
    respuesta.setHeader('ETag', etag);
    // Es una respuesta con sesión: la guarda el navegador, pero la revalida con `If-None-Match` cada vez.
    respuesta.setHeader('Cache-Control', 'private, no-cache');
    if (coincideConEtag(ifNoneMatch, etag)) {
      respuesta.status(304);
      return undefined;
    }
    return vista;
  }
}
