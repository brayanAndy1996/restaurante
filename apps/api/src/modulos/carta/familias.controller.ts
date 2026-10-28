import { Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Familias y el orden de familias y de productos (criterios 3 a 5 y 13). Firmas de la fase A: sin
 * `@Permiso` (en la fase C, `EDITAR_CARTA` en todas) y sin lógica.
 */
@Controller('carta/familias')
export class FamiliasController {
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

  @Put(':id/productos/orden')
  ordenarProductos(): never {
    throw noImplementado();
  }
}
