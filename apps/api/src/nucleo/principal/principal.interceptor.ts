import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ejecutarConPrincipal, type PeticionConPrincipal } from './almacen';

/**
 * Interceptor global que corre el resto de la petición (el interceptor de contexto de empresa, los de
 * ruta y el controlador) dentro del almacén del principal que dejó el guard de autenticación. Se registra
 * antes que el interceptor de contexto de empresa (mismo módulo, en ese orden). Las rutas públicas y las
 * de superadministrador no tienen principal de empresa y pasan sin cambios.
 */
@Injectable()
export class PrincipalInterceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    if (contexto.getType() !== 'http') return siguiente.handle();
    const principal = contexto.switchToHttp().getRequest<PeticionConPrincipal>().principal;
    if (principal === undefined) return siguiente.handle();
    return new Observable((suscriptor) =>
      ejecutarConPrincipal(principal, () => siguiente.handle().subscribe(suscriptor)),
    );
  }
}
