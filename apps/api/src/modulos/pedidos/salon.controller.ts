import { Controller, Get } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * El mapa del salón con estados y el stock del comandero (historia 004, criterios 7 y 73). Firmas de la fase
 * A: sin `@Permiso` ni `@RequiereModulo` (en la fase C, `ATENDER_MESA` y `SALON`) y sin lógica.
 */
@Controller('salon')
export class SalonController {
  @Get()
  mapa(): never {
    throw noImplementado();
  }

  @Get('stock')
  stock(): never {
    throw noImplementado();
  }
}
