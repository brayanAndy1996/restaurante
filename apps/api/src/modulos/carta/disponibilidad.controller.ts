import { Controller, Delete, HttpCode, Put } from '@nestjs/common';
import { Permiso, RequiereSucursal } from '../seguridad';
import { noImplementado } from './errores-carta';

/**
 * Agotados (86) de la sucursal activa (criterios 39 a 44): `GESTIONAR_DISPONIBILIDAD` y sucursal activa.
 * Firmas de la fase A: sin lógica hasta el grupo C5.
 */
@Controller('carta/sucursal/agotados')
export class DisponibilidadController {
  @Put(':productoId')
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  marcar(): never {
    throw noImplementado();
  }

  @Delete(':productoId')
  @HttpCode(204)
  @RequiereSucursal()
  @Permiso('GESTIONAR_DISPONIBILIDAD')
  reactivar(): never {
    throw noImplementado();
  }
}
