import { Controller, Get, Patch, Post } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Grupos de modificadores y sus modificadores (criterios 24 a 29). Firmas de la fase A: sin `@Permiso` (en
 * la fase C, `EDITAR_CARTA`) y sin lógica.
 */
@Controller('carta/grupos-modificadores')
export class GruposController {
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
