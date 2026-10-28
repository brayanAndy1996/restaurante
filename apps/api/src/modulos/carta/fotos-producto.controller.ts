import { Controller, Delete, HttpCode, Put } from '@nestjs/common';
import { noImplementado } from './errores-carta';

/**
 * Foto de un producto (criterios 14 a 17). Firmas de la fase A: sin `@Permiso` (en la fase C,
 * `EDITAR_CARTA`), sin el analizador binario de 1 MB y sin lógica.
 */
@Controller('carta/productos/:id/foto')
export class FotosProductoController {
  @Put()
  subir(): never {
    throw noImplementado();
  }

  @Delete()
  @HttpCode(204)
  quitar(): never {
    throw noImplementado();
  }
}
