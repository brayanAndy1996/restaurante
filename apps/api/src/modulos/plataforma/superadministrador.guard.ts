import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { SuperadministradoresService } from './superadministradores.service';
import type { SuperadministradorAutenticado } from './tipos';

/** Petición de Express con el superadministrador que dejó `SuperadministradorGuard`. */
export type PeticionConSuperadministrador = Request & {
  superadministrador?: SuperadministradorAutenticado;
};

const MENSAJE = 'Se requiere autenticación para esta operación';

/**
 * Guard de las rutas `/plataforma/*` (`@Superadministrador()`): valida el token
 * `Authorization: Bearer sa.<sesionId>.<secreto>` del superadministrador y deja `peticion.superadministrador`.
 * Sin una sesión de superadministrador válida (sin token, con uno mal formado, de empresa, de soporte o de
 * equipo, de una sesión cerrada o de alguien desactivado) responde 401 `NO_AUTENTICADO` sin ejecutar la
 * ruta; una sesión que pasó de las 8 horas, 401 `SESION_EXPIRADA`. Una ruta de plataforma que olvidara el
 * decorador la trataría como ruta de empresa el guard global, y un token `sa.` daría 401: falla cerrada.
 */
@Injectable()
export class SuperadministradorGuard implements CanActivate {
  constructor(
    @Inject(SuperadministradoresService)
    private readonly superadministradores: SuperadministradoresService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;
    const peticion = contexto.switchToHttp().getRequest<PeticionConSuperadministrador>();
    const autorizacion = peticion.headers.authorization;
    const token =
      typeof autorizacion === 'string' ? /^Bearer (\S+)$/i.exec(autorizacion)?.[1] : undefined;
    if (token === undefined) throw new ErrorAplicacion(401, 'NO_AUTENTICADO', MENSAJE);
    const validacion = await this.superadministradores.validarToken(token);
    if (!validacion.valida) {
      if (validacion.motivo === 'EXPIRADA') {
        throw new ErrorAplicacion(401, 'SESION_EXPIRADA', 'La sesión expiró; vuelve a ingresar');
      }
      throw new ErrorAplicacion(401, 'NO_AUTENTICADO', MENSAJE);
    }
    peticion.superadministrador = validacion.superadministrador;
    return true;
  }
}
