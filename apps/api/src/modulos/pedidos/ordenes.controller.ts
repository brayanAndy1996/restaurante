import { Controller, Get, Patch, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Órdenes: abrir, consultar, comensales, mover, unir, anular y liberar (historia 004, criterios 9 a 13, 42 a
 * 49 y 55). Firmas de la fase A: sin `@Permiso` ni `@RequiereModulo` (en la fase C, `ATENDER_MESA` y `SALON`;
 * `MOVER_UNIR_MESAS` en el movimiento y la unión; `ANULAR_ORDEN` en la anulación), sin validación y sin lógica.
 */
@Controller('ordenes')
export class OrdenesController {
  @Post()
  abrir(): never {
    throw noImplementado();
  }

  @Get(':id')
  consultar(): never {
    throw noImplementado();
  }

  @Patch(':id')
  modificar(): never {
    throw noImplementado();
  }

  @Post(':id/movimiento')
  mover(): never {
    throw noImplementado();
  }

  @Post(':id/union')
  unir(): never {
    throw noImplementado();
  }

  @Post(':id/anulacion')
  anular(): never {
    throw noImplementado();
  }

  @Post(':id/liberacion')
  liberar(): never {
    throw noImplementado();
  }
}
