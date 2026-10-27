import {
  ExecutionContext,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { METADATO_SUPERADMINISTRADOR } from '../../nucleo/principal';
import {
  SuperadministradorGuard,
  type PeticionConSuperadministrador,
} from './superadministrador.guard';
import type { SuperadministradorAutenticado } from './tipos';

export const SUPERADMINISTRADOR = METADATO_SUPERADMINISTRADOR;

/**
 * Ruta de plataforma: compone `@SinEmpresa()` (no pertenece a ninguna empresa), la marca de metadatos
 * y `@UseGuards(SuperadministradorGuard)`. Toda ruta `/plataforma/*` lo lleva, salvo
 * `POST /plataforma/sesiones`, que es pública.
 */
export const Superadministrador = () =>
  applyDecorators(
    SinEmpresa(),
    SetMetadata(SUPERADMINISTRADOR, true),
    UseGuards(SuperadministradorGuard),
  );

/** El superadministrador autenticado de la petición (lo deja `SuperadministradorGuard`). */
export const SuperadministradorActual = createParamDecorator(
  (_dato: unknown, contexto: ExecutionContext): SuperadministradorAutenticado | undefined =>
    contexto.switchToHttp().getRequest<PeticionConSuperadministrador>().superadministrador,
);
