import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PeticionConPuente } from '../../nucleo/principal';
import { AutenticacionPuenteService, puenteNoAutenticado } from './autenticacion-puente.service';

/** `Authorization: Bearer <token>`, o `undefined` si falta o tiene otra forma. */
function tokenDeBearer(peticion: Request): string | undefined {
  const autorizacion = peticion.headers.authorization;
  return typeof autorizacion === 'string' ? /^Bearer (\S+)$/i.exec(autorizacion)?.[1] : undefined;
}

/**
 * Guard de las rutas `/puente/*` con la credencial del puente (`@Puente()`, historia 004, criterios 109 y 129; ruta
 * crítica P6). Parsea el token `pu.<empresa>.<id>.<secreto>`, verifica en un contexto de empresa propio (con la
 * empresa **del token**) que existe un puente activo con ese id y esa huella, y deja en la petición la empresa, la
 * sucursal y el puente: de ahí salen el contexto de empresa y el actor `puente:<id>` de la petición. Sin
 * credencial, con otro tipo de token, mal formada, adulterada, de un puente revocado o de otra empresa: 401
 * `NO_AUTENTICADO`, siempre con el mismo cuerpo y sin bloqueo por intentos (el secreto tiene 256 bits).
 */
@Injectable()
export class PuenteGuard implements CanActivate {
  constructor(
    @Inject(AutenticacionPuenteService) private readonly autenticacion: AutenticacionPuenteService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;
    const peticion = contexto.switchToHttp().getRequest<PeticionConPuente>();
    const token = tokenDeBearer(peticion);
    if (token === undefined) throw puenteNoAutenticado();
    peticion.puente = await this.autenticacion.autenticarPuente(token);
    return true;
  }
}

/**
 * Guard de `POST /puente/vinculacion` (`@VinculacionPuente()`, criterios 107 y 109). Comprueba el código `vi.…`
 * (sin usar, sin invalidar, sin vencer y con su secreto) y deja en la petición la vinculación y el id del puente
 * que nacerá con ella. Mal formado o de otro tipo: 401 `NO_AUTENTICADO`; bien formado pero que no sirve: 401
 * `VINCULACION_INVALIDA`, el mismo cuerpo para todos los casos. No gasta el código: lo hace el servicio.
 */
@Injectable()
export class VinculacionGuard implements CanActivate {
  constructor(
    @Inject(AutenticacionPuenteService) private readonly autenticacion: AutenticacionPuenteService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;
    const peticion = contexto.switchToHttp().getRequest<PeticionConPuente>();
    const token = tokenDeBearer(peticion);
    if (token === undefined) throw puenteNoAutenticado();
    peticion.vinculacion = await this.autenticacion.autenticarVinculacion(token);
    return true;
  }
}
