import {
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import {
  METADATO_PUENTE,
  METADATO_VINCULACION_PUENTE,
  type PeticionConPuente,
  type PuenteAutenticado,
  type VinculacionAutenticada,
} from '../../nucleo/principal';
import { PuenteGuard, VinculacionGuard } from './puente.guard';

export const PUENTE = METADATO_PUENTE;
export const VINCULACION_PUENTE = METADATO_VINCULACION_PUENTE;

/**
 * Ruta del puente de impresión: compone la marca de metadatos (el guard global de autenticación la deja pasar) y
 * `@UseGuards(PuenteGuard)`. Toda ruta `/puente/*` lo lleva, salvo `POST /puente/vinculacion`. No lleva
 * `@SinEmpresa()`: la petición corre con la empresa del token, la sucursal del puente y el actor
 * `puente:<puenteId>` (criterio 109), que deja el guard en la petición.
 */
export const Puente = () => applyDecorators(SetMetadata(PUENTE, true), UseGuards(PuenteGuard));

/** `POST /puente/vinculacion`: se autentica con el código de vinculación `vi.…` (criterio 107). */
export const VinculacionPuente = () =>
  applyDecorators(SetMetadata(VINCULACION_PUENTE, true), UseGuards(VinculacionGuard));

/** El puente autenticado de la petición (lo dejó `PuenteGuard`). */
export const PuenteActual = createParamDecorator(
  (_dato: unknown, contexto: ExecutionContext): PuenteAutenticado => {
    const puente = contexto.switchToHttp().getRequest<PeticionConPuente>().puente;
    if (puente === undefined) throw new Error('La ruta no lleva @Puente()');
    return puente;
  },
);

/** La vinculación vigente de la petición (la dejó `VinculacionGuard`). */
export const VinculacionActual = createParamDecorator(
  (_dato: unknown, contexto: ExecutionContext): VinculacionAutenticada => {
    const vinculacion = contexto.switchToHttp().getRequest<PeticionConPuente>().vinculacion;
    if (vinculacion === undefined) throw new Error('La ruta no lleva @VinculacionPuente()');
    return vinculacion;
  },
);
