import { Controller, Delete, HttpCode, Put } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Agotados (86) de la sucursal activa (criterios 39 a 44). Firmas de la fase A: sin `@Permiso` ni
 * `@RequiereSucursal` (en la fase C, `GESTIONAR_DISPONIBILIDAD` y sucursal activa) y sin lógica.
 */
@Controller('carta/sucursal/agotados')
export class DisponibilidadController {
  @Put(':productoId')
  marcar(): never {
    throw noImplementado();
  }

  @Delete(':productoId')
  @HttpCode(204)
  reactivar(): never {
    throw noImplementado();
  }
}
