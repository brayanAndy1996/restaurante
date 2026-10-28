import { Controller, Get, Put } from '@nestjs/common';
import { Permiso } from '../seguridad';
import { noImplementado } from './errores-carta';

/**
 * Precio y disponibilidad de un producto por sucursal (criterios 18 a 23 y 19b). Firmas de la fase A: sin
 * lógica hasta el grupo C2 (la regla de la sucursal ajustada se suma a `@Permiso('EDITAR_CARTA')` ahí).
 */
@Controller('carta/productos/:id/sucursales')
export class AjustesSucursalController {
  @Get()
  @Permiso('EDITAR_CARTA')
  listar(): never {
    throw noImplementado();
  }

  @Put(':sucursalId')
  @Permiso('EDITAR_CARTA')
  ajustar(): never {
    throw noImplementado();
  }
}
