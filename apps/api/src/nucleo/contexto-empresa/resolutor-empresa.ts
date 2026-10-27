import type { Request } from 'express';

/** Token de Nest del resolutor de empresa de la petición. */
export const RESOLUTOR_EMPRESA = Symbol('RESOLUTOR_EMPRESA');

export interface ResolutorEmpresa {
  /** Empresa de la petición o `null` si no se pudo resolver (el interceptor responde 401). */
  resolver(peticion: Request): Promise<string | null>;
}
