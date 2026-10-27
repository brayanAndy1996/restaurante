import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * Interceptor global: si la ruta no tiene `@SinEmpresa()`, pide la empresa al resolutor, responde
 * 401 `EMPRESA_NO_RESUELTA` si es `null` y corre el controlador dentro de `ContextoEmpresa.ejecutar`.
 */
@Injectable()
export class ContextoEmpresaInterceptor implements NestInterceptor {
  intercept(_contexto: ExecutionContext, _siguiente: CallHandler): Observable<unknown> {
    throw new Error('No implementado');
  }
}
