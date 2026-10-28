import { Controller, Get, Patch, Post } from '@nestjs/common';
import { Idempotente } from '../../nucleo/idempotencia';
import { Permiso } from '../seguridad';
import { noImplementado } from './errores-carta';

/**
 * Grupos de modificadores y sus modificadores (criterios 24 a 29): `EDITAR_CARTA`. Firmas de la fase A: sin
 * lógica hasta el grupo C3.
 */
@Controller('carta/grupos-modificadores')
export class GruposController {
  @Get()
  @Permiso('EDITAR_CARTA')
  listar(): never {
    throw noImplementado();
  }

  @Get(':id')
  @Permiso('EDITAR_CARTA')
  obtener(): never {
    throw noImplementado();
  }

  @Post()
  @Idempotente()
  @Permiso('EDITAR_CARTA')
  crear(): never {
    throw noImplementado();
  }

  @Patch(':id')
  @Permiso('EDITAR_CARTA')
  modificar(): never {
    throw noImplementado();
  }
}
