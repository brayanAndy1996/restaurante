import type { Request } from 'express';

/**
 * Quién hace una petición del puente de impresión (historia 004, entrega 3b, criterio 109): lo que deja
 * `PuenteGuard` en la petición después de verificar la credencial `pu.<empresa>.<id>.<secreto>` bajo la RLS de la
 * empresa del token. La empresa, la sucursal y el actor `puente:<puenteId>` salen de aquí, nunca de una cabecera,
 * un parámetro ni el cuerpo.
 */
export interface PuenteAutenticado {
  empresaId: string;
  puenteId: string;
  /** La sucursal del puente: todo lo que ve y cambia es de ella. */
  sucursalId: string;
}

/**
 * Lo que deja `VinculacionGuard` en `POST /puente/vinculacion` después de comprobar el código `vi.…` (criterio
 * 107): la vinculación vigente y el id que tendrá el puente que nace con ella. El actor de la petición es ya
 * `puente:<puenteIdNuevo>`, así la fila del puente y la auditoría de `vincular_puente` quedan a su nombre.
 */
export interface VinculacionAutenticada {
  empresaId: string;
  vinculacionId: string;
  sucursalId: string;
  puenteIdNuevo: string;
}

/** Petición de Express con lo que dejan los guards del puente. */
export type PeticionConPuente = Request & {
  puente?: PuenteAutenticado;
  vinculacion?: VinculacionAutenticada;
};
