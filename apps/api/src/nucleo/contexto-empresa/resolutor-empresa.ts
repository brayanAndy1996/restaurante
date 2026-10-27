import type { Request } from 'express';
import type { ActorTransaccion } from './actor';

/** Token de Nest del resolutor de empresa de la petición. */
export const RESOLUTOR_EMPRESA = Symbol('RESOLUTOR_EMPRESA');

export interface ResolutorEmpresa {
  /** Empresa de la petición o `null` si no se pudo resolver (el interceptor responde 401). */
  resolver(peticion: Request): Promise<string | null>;
  /**
   * Actor de la petición para la trazabilidad (criterio 117), o `null` si no hay. El interceptor lo
   * pasa a `ContextoEmpresa.ejecutar` desde la tarea T7; opcional hasta entonces.
   */
  actor?(peticion: Request): Promise<ActorTransaccion | null>;
}
