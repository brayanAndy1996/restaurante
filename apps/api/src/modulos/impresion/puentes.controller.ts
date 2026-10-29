import { Controller, Delete, Get, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Vinculación y lista de puentes de la sucursal (historia 004, criterios 106 y 108). Firmas de la fase A (T35):
 * sin `@Permiso` (en la fase C, `ADMINISTRAR`, con `Idempotency-Key` opcional al crear la vinculación), sin
 * validación y sin lógica.
 */
@Controller('sucursales/:sucursalId')
export class PuentesController {
  @Post('vinculaciones-puente')
  crearVinculacion(): never {
    throw noImplementado();
  }

  @Get('puentes')
  listar(): never {
    throw noImplementado();
  }

  @Delete('puentes/:id')
  revocar(): never {
    throw noImplementado();
  }
}
