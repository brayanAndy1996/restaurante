import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { Principal } from './principal';

/**
 * Almacén del principal de la petición en curso (`AsyncLocalStorage`): lo llena el `PrincipalInterceptor`
 * con el principal que dejó el guard de autenticación, y lo leen `SesionActual`, el servicio de
 * auditoría y el resto del código de la petición sin recibirlo por parámetro. Fuera de una petición
 * autenticada está vacío.
 */
const almacen = new AsyncLocalStorage<Principal>();

/** Corre `fn` (y todo lo que lance de forma asíncrona) con `principal` como principal vigente. */
export function ejecutarConPrincipal<T>(principal: Principal, fn: () => T): T {
  return almacen.run(principal, fn);
}

/** Principal de la petición en curso, o `undefined` fuera de una petición autenticada. */
export function principalActual(): Principal | undefined {
  return almacen.getStore();
}

/** Petición de Express con lo que deja el guard de autenticación. */
export type PeticionConPrincipal = Request & { principal?: Principal };
