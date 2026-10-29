import { Controller, Get, Put } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Pantalla de cocina (KDS) (historia 004, criterios 56 a 63). Firmas de la fase A: sin `@Permiso` ni
 * `@RequiereModulo` (en la fase C, `USAR_KDS` y `COCINA`), sin validación y sin lógica.
 */
@Controller('cocina')
export class CocinaController {
  @Get('comandas')
  comandas(): never {
    throw noImplementado();
  }

  @Put('lineas/:id/estado')
  cambiarEstado(): never {
    throw noImplementado();
  }

  @Put('comandas/:id/listo')
  todoListo(): never {
    throw noImplementado();
  }

  @Put('comandas/:id/visto')
  visto(): never {
    throw noImplementado();
  }
}
