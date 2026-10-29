import { Controller, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Enviar la comanda y marchar (historia 004, criterios 15 a 33; ruta crítica P2). Firmas de la fase A: sin
 * `@Permiso` ni `@RequiereModulo` (en la fase C, `ATENDER_MESA` y `SALON`), sin validación y sin lógica.
 */
@Controller('ordenes/:id')
export class EnviosController {
  @Post('envios')
  enviar(): never {
    throw noImplementado();
  }

  @Post('marchas')
  marchar(): never {
    throw noImplementado();
  }
}
