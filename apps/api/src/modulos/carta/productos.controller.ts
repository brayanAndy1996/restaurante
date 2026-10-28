import { Controller, Get, Patch, Post } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Productos (criterios 6 a 12). Firmas de la fase A: sin `@Permiso` (en la fase C, `EDITAR_CARTA`) y sin
 * lógica.
 */
@Controller('carta/productos')
export class ProductosController {
  @Get()
  listar(): never {
    throw noImplementado();
  }

  @Get(':id')
  obtener(): never {
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
}
