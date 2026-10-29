import { Controller, Patch, Post } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Mesas del salón (historia 004, criterios 3 a 6). Firmas de la fase A: sin `@Permiso` (en la fase C,
 * `ADMINISTRAR` en todas), sin validación y sin lógica.
 */
@Controller('sucursales/:sucursalId')
export class MesasController {
  @Post('zonas/:zonaId/mesas')
  crear(): never {
    throw noImplementado();
  }

  @Patch('mesas/:id')
  modificar(): never {
    throw noImplementado();
  }
}
