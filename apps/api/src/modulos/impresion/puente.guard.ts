import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { parsearTokenPuente, parsearTokenVinculacion } from './tokens-puente';

const MENSAJE = 'Se requiere autenticación para esta operación';

/** `Authorization: Bearer <token>`, o `undefined` si falta o tiene otra forma. */
function tokenDeBearer(peticion: Request): string | undefined {
  const autorizacion = peticion.headers.authorization;
  return typeof autorizacion === 'string' ? /^Bearer (\S+)$/i.exec(autorizacion)?.[1] : undefined;
}

/**
 * Guard de las rutas `/puente/*` con la credencial del puente (`@Puente()`, historia 004, criterios 109 y 129).
 *
 * Firma de la fase A (T35): un token que no tiene la forma de un `pu.…` (sin `Authorization`, mal formado, o de
 * otro tipo: `se.`, `sa.`, `eq.`, `vi.`) ya responde 401 `NO_AUTENTICADO` sin consultar nada; uno bien formado
 * lanza "No implementado" (500) hasta que T40 verifique la fila del puente bajo RLS, abra el contexto de la
 * empresa con el actor `puente:<id>` y deje el puente en la petición.
 */
@Injectable()
export class PuenteGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    if (contexto.getType() !== 'http') return true;
    const token = tokenDeBearer(contexto.switchToHttp().getRequest<Request>());
    if (token === undefined || parsearTokenPuente(token) === null) {
      throw new ErrorAplicacion(401, 'NO_AUTENTICADO', MENSAJE);
    }
    throw noImplementado();
  }
}

/**
 * Guard de `POST /puente/vinculacion` (`@VinculacionPuente()`, criterios 107 y 109).
 *
 * Firma de la fase A (T35): sin `Authorization` o con un token que no tiene la forma de un `vi.…` responde 401
 * `NO_AUTENTICADO`; uno bien formado lanza "No implementado" (500) hasta que T40 lo valide y responda, si no
 * sirve, 401 `VINCULACION_INVALIDA`.
 */
@Injectable()
export class VinculacionGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    if (contexto.getType() !== 'http') return true;
    const token = tokenDeBearer(contexto.switchToHttp().getRequest<Request>());
    if (token === undefined || parsearTokenVinculacion(token) === null) {
      throw new ErrorAplicacion(401, 'NO_AUTENTICADO', MENSAJE);
    }
    throw noImplementado();
  }
}
