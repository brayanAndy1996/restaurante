import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import {
  cartaWebEntradaSchema,
  cartaWebSucursalEntradaSchema,
  type CartaWebEntrada,
  type CartaWebRespuesta,
  type CartaWebSucursalEntrada,
  type CartaWebSucursalRespuesta,
} from '@restaurante/contratos';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { CartaWebService } from './carta-web.service';

/**
 * Configuración de la carta web (historia 005, criterios 1 a 5). FIRMAS: sin `@Permiso('ADMINISTRAR')` hasta la
 * fase C (T5), que también las implementa.
 */
@Controller('carta-web')
export class CartaWebController {
  constructor(@Inject(CartaWebService) private readonly cartaWeb: CartaWebService) {}

  /** 200 `cartaWebRespuesta`. */
  @Get()
  consultar(): Promise<CartaWebRespuesta> {
    return this.cartaWeb.consultar();
  }

  /** 200 `cartaWebRespuesta`; 400; 403; 409 `CONFLICTO` (la dirección la usa otro restaurante). */
  @Put()
  configurar(
    @Body(new PipeZod(cartaWebEntradaSchema)) entrada: CartaWebEntrada,
  ): Promise<CartaWebRespuesta> {
    return this.cartaWeb.configurar(entrada);
  }

  /** 200 la fila de la sucursal; 400; 403; 404; 409 `CONFLICTO` o `CARTA_WEB_SIN_CONFIGURAR`. */
  @Put('sucursales/:sucursalId')
  configurarSucursal(
    @Param('sucursalId', PipeUuid) sucursalId: string,
    @Body(new PipeZod(cartaWebSucursalEntradaSchema)) entrada: CartaWebSucursalEntrada,
  ): Promise<CartaWebSucursalRespuesta> {
    return this.cartaWeb.configurarSucursal(sucursalId, entrada);
  }
}
