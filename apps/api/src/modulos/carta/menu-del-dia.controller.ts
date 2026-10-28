import { Controller, Get, Put } from '@nestjs/common';
import { Permiso, RequiereSucursal } from '../seguridad';
import { noImplementado } from './errores-carta';

/**
 * Menú del día de la sucursal activa (criterios 34 a 38): `GESTIONAR_DISPONIBILIDAD` y sucursal activa.
 * Firmas de la fase A: sin lógica hasta el grupo C4.
 */
@Controller('carta/sucursal/menu-del-dia')
export class MenuDelDiaController {
  @Get()
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  consultar(): never {
    throw noImplementado();
  }

  @Put(':productoId')
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  armar(): never {
    throw noImplementado();
  }
}
