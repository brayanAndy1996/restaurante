import { Controller, Get } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Vista de la carta de la sucursal activa, con `ETag` (criterios 47 a 50). Firma de la fase A: sin
 * `@RequiereSucursal` (en la fase C, cualquier rol con sucursal activa) y sin lógica.
 */
@Controller('carta/sucursal')
export class VistaSucursalController {
  @Get()
  vista(): never {
    throw noImplementado();
  }
}
