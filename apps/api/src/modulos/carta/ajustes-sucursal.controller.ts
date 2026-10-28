import { Controller, Get, Put } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Precio y disponibilidad de un producto por sucursal (criterios 18 a 23 y 19b). Firmas de la fase A: sin
 * `@Permiso` (en la fase C, `EDITAR_CARTA` más la regla de la sucursal ajustada) y sin lógica.
 */
@Controller('carta/productos/:id/sucursales')
export class AjustesSucursalController {
  @Get()
  listar(): never {
    throw noImplementado();
  }

  @Put(':sucursalId')
  ajustar(): never {
    throw noImplementado();
  }
}
