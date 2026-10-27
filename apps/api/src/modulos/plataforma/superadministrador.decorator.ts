import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { SuperadministradorGuard } from './superadministrador.guard';

export const SUPERADMINISTRADOR = 'superadministrador';

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
