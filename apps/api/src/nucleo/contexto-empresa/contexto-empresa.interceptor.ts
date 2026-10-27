import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { uuidSchema } from '@restaurante/contratos';
import type { Request } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { ErrorAplicacion } from '../errores/error-aplicacion';
import { ContextoEmpresa } from './contexto-empresa';
import { RESOLUTOR_EMPRESA, type ResolutorEmpresa } from './resolutor-empresa';
import { ResolutorEmpresaNulo } from './resolutor-empresa-nulo';
import { SIN_EMPRESA } from './sin-empresa.decorator';

/**
 * Interceptor global: si la ruta no tiene `@SinEmpresa()`, pide la empresa al resolutor, responde
 * 401 `EMPRESA_NO_RESUELTA` si es `null` y corre el controlador dentro de `ContextoEmpresa.ejecutar`,
 * con el actor que da el resolutor (historia 002, criterio 117; sin actor la transacción solo puede
 * leer). Los guards de Nest corren antes: el guard de autenticación deja el principal en la petición
 * y el resolutor de sesión lo lee. Sin un resolutor registrado se usa el nulo (todo responde 401).
 */
@Injectable()
export class ContextoEmpresaInterceptor implements NestInterceptor {
  private readonly resolutor: ResolutorEmpresa;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Optional() @Inject(RESOLUTOR_EMPRESA) resolutor?: ResolutorEmpresa,
  ) {
    this.resolutor = resolutor ?? new ResolutorEmpresaNulo();
  }

  async intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Promise<Observable<unknown>> {
    // Solo HTTP: otros transportes (colas, WebSockets) envuelven su trabajo en ContextoEmpresa.ejecutar.
    if (contexto.getType() !== 'http') return siguiente.handle();

    const sinEmpresa = this.reflector.getAllAndOverride<boolean | undefined>(SIN_EMPRESA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (sinEmpresa === true) return siguiente.handle();

    const peticion = contexto.switchToHttp().getRequest<Request>();
    const empresaId = await this.resolutor.resolver(peticion);
    if (empresaId === null || !uuidSchema.safeParse(empresaId).success) {
      throw new ErrorAplicacion(
        401,
        'EMPRESA_NO_RESUELTA',
        'No se pudo determinar la empresa de la petición',
      );
    }
    const actor = (await this.resolutor.actor?.(peticion)) ?? null;
    return from(
      this.contexto.ejecutar(
        empresaId,
        () => lastValueFrom(siguiente.handle(), { defaultValue: undefined }),
        actor === null ? {} : { actor },
      ),
    );
  }
}
