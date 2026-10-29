import { Controller, Get, Patch, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Impresoras de la sucursal (historia 004, criterios 103 a 105 y 127). Firmas de la fase A (T35): sin
 * `@Permiso` (en la fase C, `ADMINISTRAR` en todas, con `Idempotency-Key` opcional en la prueba), sin validación y
 * sin lógica.
 */
@Controller('sucursales/:sucursalId/impresoras')
export class ImpresorasController {
  @Get()
  listar(): never {
    throw noImplementado();
  }

  @Post()
  crear(): never {
    throw noImplementado();
  }

  @Patch(':id')
  modificar(): never {
    throw noImplementado();
  }

  @Post(':id/prueba')
  paginaDePrueba(): never {
    throw noImplementado();
  }
}
