import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { Principal } from './principal';

/**
 * La autorización de supervisor que `@Permiso` consumió en la petición en curso (historia 004, criterio 41):
 * quién la pidió, quién la dio, con qué motivo y su id. La auditoría de la acción y el `autorizadoPor` de la
 * respuesta la leen con `SesionActual.autorizacionConsumida()`.
 */
export interface AutorizacionDePeticion {
  autorizacionId: string;
  solicitanteId: string;
  autorizadorId: string;
  motivo: string;
}

/** Lo que vive mientras dura la petición: su principal y, si la acción lo necesitó, la autorización consumida. */
interface EstadoDePeticion {
  principal: Principal;
  autorizacion?: AutorizacionDePeticion;
}

/**
 * Almacén del principal de la petición en curso (`AsyncLocalStorage`): lo llena el `PrincipalInterceptor`
 * con el principal que dejó el guard de autenticación, y lo leen `SesionActual`, el servicio de
 * auditoría y el resto del código de la petición sin recibirlo por parámetro. Fuera de una petición
 * autenticada está vacío. El estado es de la petición (no del principal, que en el modo de prueba puede
 * compartirse): una autorización consumida nunca se ve desde otra petición.
 */
const almacen = new AsyncLocalStorage<EstadoDePeticion>();

/** Corre `fn` (y todo lo que lance de forma asíncrona) con `principal` como principal vigente. */
export function ejecutarConPrincipal<T>(principal: Principal, fn: () => T): T {
  return almacen.run({ principal }, fn);
}

/** Principal de la petición en curso, o `undefined` fuera de una petición autenticada. */
export function principalActual(): Principal | undefined {
  return almacen.getStore()?.principal;
}

/** Guarda la autorización que `@Permiso` consumió en esta petición (no hace nada fuera de una petición). */
export function guardarAutorizacionConsumida(autorizacion: AutorizacionDePeticion): void {
  const estado = almacen.getStore();
  if (estado !== undefined) estado.autorizacion = autorizacion;
}

/** La autorización consumida en la petición en curso, o `undefined` si la acción no la necesitó. */
export function autorizacionConsumidaActual(): AutorizacionDePeticion | undefined {
  return almacen.getStore()?.autorizacion;
}

/** Petición de Express con lo que deja el guard de autenticación. */
export type PeticionConPrincipal = Request & { principal?: Principal };
