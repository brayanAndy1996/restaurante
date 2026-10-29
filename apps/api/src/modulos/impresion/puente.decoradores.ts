import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { METADATO_PUENTE, METADATO_VINCULACION_PUENTE } from '../../nucleo/principal';
import { PuenteGuard, VinculacionGuard } from './puente.guard';

export const PUENTE = METADATO_PUENTE;
export const VINCULACION_PUENTE = METADATO_VINCULACION_PUENTE;

/**
 * Ruta del puente de impresión: compone la marca de metadatos (el guard global de autenticación la deja pasar) y
 * `@UseGuards(PuenteGuard)`. Toda ruta `/puente/*` lo lleva, salvo `POST /puente/vinculacion`. No lleva
 * `@SinEmpresa()`: la petición corre con la empresa del token, la sucursal del puente y el actor
 * `puente:<puenteId>` (criterio 109), que deja el guard en la petición (T40).
 */
export const Puente = () => applyDecorators(SetMetadata(PUENTE, true), UseGuards(PuenteGuard));

/** `POST /puente/vinculacion`: se autentica con el código de vinculación `vi.…` (criterio 107). */
export const VinculacionPuente = () =>
  applyDecorators(SetMetadata(VINCULACION_PUENTE, true), UseGuards(VinculacionGuard));
