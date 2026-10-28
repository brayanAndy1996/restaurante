import { Controller, Get, Patch, Post } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Estaciones de producción (criterios 1, 2 y 2b). Firmas de la fase A: sin `@Permiso` (se agregan en la
 * fase C: `EDITAR_CARTA` en `GET`; `ADMINISTRAR` en `POST` y `PATCH`) y sin lógica.
 */
@Controller('carta/estaciones')
export class EstacionesController {
  @Get()
  listar(): never {
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
