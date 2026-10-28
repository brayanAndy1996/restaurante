import { Controller, Get, Put } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Menú del día de la sucursal activa (criterios 34 a 38). Firmas de la fase A: sin `@Permiso` ni
 * `@RequiereSucursal` (en la fase C, `GESTIONAR_DISPONIBILIDAD` y sucursal activa) y sin lógica.
 */
@Controller('carta/sucursal/menu-del-dia')
export class MenuDelDiaController {
  @Get()
  consultar(): never {
    throw noImplementado();
  }

  @Put(':productoId')
  armar(): never {
    throw noImplementado();
  }
}
