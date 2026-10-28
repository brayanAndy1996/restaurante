import { Controller, Get } from '@nestjs/common';
import { RequiereSucursal } from '../seguridad';
import { noImplementado } from './errores-carta';

/**
 * Vista de la carta de la sucursal activa, con `ETag` (criterios 47 a 50): cualquier rol con sucursal activa,
 * sin `@Permiso`. Firma de la fase A: sin lógica hasta el grupo C5.
 */
@Controller('carta/sucursal')
export class VistaSucursalController {
  @Get()
  @RequiereSucursal()
  vista(): never {
    throw noImplementado();
  }
}
