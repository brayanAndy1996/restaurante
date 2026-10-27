import { SetMetadata } from '@nestjs/common';

export const SIN_EMPRESA = 'sin-empresa';

/** Marca una ruta que no pertenece a ninguna empresa (por ejemplo `GET /health`). */
export const SinEmpresa = () => SetMetadata(SIN_EMPRESA, true);
