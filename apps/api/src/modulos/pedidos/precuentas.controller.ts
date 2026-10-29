import { Controller, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Pre-cuenta (historia 004, criterios 50 a 54). Firma de la fase A: sin `@Permiso` ni `@RequiereModulo` (en
 * la fase C, `ATENDER_MESA` y `SALON`), sin validación y sin lógica.
 */
@Controller('ordenes/:id/precuentas')
export class PrecuentasController {
  @Post()
  emitir(): never {
    throw noImplementado();
  }
}
