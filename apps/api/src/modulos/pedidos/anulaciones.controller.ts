import { Controller, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Anular un ítem enviado (historia 004, criterios 34 a 41; ruta crítica P3). Firma de la fase A: sin
 * `@Permiso` ni `@RequiereModulo` (en la fase C, `ANULAR_ITEM_ENVIADO` con clave y `SALON`), sin validación y
 * sin lógica.
 */
@Controller('ordenes/:id/items/:itemId')
export class AnulacionesController {
  @Post('anulaciones')
  anular(): never {
    throw noImplementado();
  }
}
