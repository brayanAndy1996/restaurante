import { Inject, Injectable } from '@nestjs/common';
import { uuidSchema } from '@restaurante/contratos';
import type { Request } from 'express';
import { ENTORNO, type Entorno } from '../../config/entorno';
import type { ActorTransaccion } from './actor';
import type { ResolutorEmpresa } from './resolutor-empresa';

export const CABECERA_EMPRESA = 'x-empresa-id';

/**
 * Entornos en los que se permite resolver la empresa por cabecera: solo `test` (historia 002, criterio 7).
 * Con `development` o `production` y `EMPRESA_POR_HEADER=habilitado` la API no arranca.
 */
export const ENTORNOS_CON_CABECERA: readonly Entorno['NODE_ENV'][] = ['test'];

/** `true` si la configuración activa el resolutor por cabecera. */
export function cabeceraHabilitada(entorno: Pick<Entorno, 'NODE_ENV' | 'EMPRESA_POR_HEADER'>) {
  return (
    entorno.EMPRESA_POR_HEADER === 'habilitado' && ENTORNOS_CON_CABECERA.includes(entorno.NODE_ENV)
  );
}

/**
 * Lee la cabecera `x-empresa-id`. Solo con `NODE_ENV=test` y `EMPRESA_POR_HEADER=habilitado`; prohibido
 * en cualquier otro entorno. Segunda barrera: aunque la validación del entorno y la elección del
 * proveedor fallaran, este constructor se niega a existir fuera de `test`. Desde la historia 002 lo usa
 * solo el modo de prueba del guard de autenticación (`AutenticacionGuard`), que arma con él el principal
 * de prueba cuando la petición no trae `Authorization`.
 */
@Injectable()
export class ResolutorEmpresaPorCabecera implements ResolutorEmpresa {
  constructor(@Inject(ENTORNO) entorno: Entorno) {
    if (!cabeceraHabilitada(entorno)) {
      throw new Error(
        'ResolutorEmpresaPorCabecera solo puede usarse con NODE_ENV=test y ' +
          'EMPRESA_POR_HEADER=habilitado (prohibido con development y production)',
      );
    }
  }

  async resolver(peticion: Request): Promise<string | null> {
    const valor = peticion.headers[CABECERA_EMPRESA];
    if (typeof valor !== 'string' || !uuidSchema.safeParse(valor).success) return null;
    return valor.toLowerCase();
  }

  /** El modo de prueba escribe con el actor de sistema `prueba` (criterio 117). */
  async actor(_peticion: Request): Promise<ActorTransaccion | null> {
    return { sistema: 'prueba' };
  }
}
