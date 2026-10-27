import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';

/**
 * Guard de las rutas `/plataforma/*`: valida el token `sa.<sesionId>.<secreto>` del superadministrador y
 * deja `peticion.superadministrador`. Sin sesión de superadministrador responde 401 `NO_AUTENTICADO`.
 * Lógica en la tarea T15 (hasta entonces lanza `Error('No implementado')`).
 */
@Injectable()
export class SuperadministradorGuard implements CanActivate {
  canActivate(_contexto: ExecutionContext): boolean {
    return noImplementado();
  }
}
