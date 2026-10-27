import type { Accion, RequisitoPermiso } from '@restaurante/dominio';
import { useSesion } from './sesion';

/**
 * Qué exige una acción a la persona de la sesión, según `permisos` de `GET /sesion` (la matriz de
 * `packages/dominio` calculada por la API para su rol en la sucursal activa):
 *
 * - `permitido`: se hace sin más;
 * - `clave`: hace falta la clave de un supervisor (ver `VentanaClaveSupervisor`);
 * - `prohibido`: no puede, y la pantalla no debe ofrecerla.
 *
 * Sin sesión, sin rol todavía (aún no eligió sucursal) o con una acción que la API no conoce, es
 * `prohibido`: ante la duda, la opción no aparece.
 */
export function requisitoDeSesion(
  permisos: Partial<Record<Accion, RequisitoPermiso>> | null | undefined,
  accion: Accion,
): RequisitoPermiso {
  return permisos?.[accion] ?? 'prohibido';
}

export function usePermiso(accion: Accion): RequisitoPermiso {
  const { sesion } = useSesion();
  return requisitoDeSesion(sesion?.permisos, accion);
}

/** Todos los permisos de la sesión (para una pantalla que decide varias acciones a la vez). */
export function usePermisos(): (accion: Accion) => RequisitoPermiso {
  const { sesion } = useSesion();
  const permisos = sesion?.permisos;
  return (accion) => requisitoDeSesion(permisos, accion);
}
