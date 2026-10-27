import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';

/**
 * Guard global de autenticación: toda ruta exige sesión salvo las marcadas `@Publica()` o
 * `@Superadministrador()`. Todavía NO está registrado como `APP_GUARD` (lo hace la tarea T10); hasta
 * entonces su cuerpo lanza `Error('No implementado')`.
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  canActivate(_contexto: ExecutionContext): boolean {
    return noImplementado();
  }
}
