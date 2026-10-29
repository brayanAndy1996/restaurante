import { Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Zonas del salón (historia 004, criterios 1, 2, 5 y 6). Firmas de la fase A: sin `@Permiso` (en la fase C,
 * `ADMINISTRAR` en todas), sin validación y sin lógica.
 */
@Controller('sucursales/:sucursalId/zonas')
export class ZonasController {
  @Get()
  listar(): never {
    throw noImplementado();
  }

  @Post()
  crear(): never {
    throw noImplementado();
  }

  @Put('orden')
  ordenar(): never {
    throw noImplementado();
  }

  @Patch(':id')
  modificar(): never {
    throw noImplementado();
  }
}
