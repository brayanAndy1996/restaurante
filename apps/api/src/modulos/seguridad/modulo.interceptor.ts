import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Modulo } from '@restaurante/dominio';
import type { Observable } from 'rxjs';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { principalActual } from '../../nucleo/principal';
import { SuscripcionService } from '../plataforma/suscripcion.service';

/** Metadato de `@RequiereModulo` (se define aquí para que el decorador y el interceptor no se importen entre sí). */
export const REQUIERE_MODULO = 'requiere-modulo';

/**
 * Aplica `@RequiereModulo(modulo)` (criterio 77): si el plan de la suscripción de la sucursal activa no
 * incluye el módulo, responde 403 `MODULO_NO_INCLUIDO` y el controlador no se ejecuta. Corre dentro de la
 * transacción de empresa del controlador (después del interceptor de contexto) y lee el plan vigente en
 * cada petición, así que un cambio de plan rige desde la siguiente. Sin sucursal activa responde 409
 * `SUCURSAL_NO_ELEGIDA` (el guard ya lo hace antes: `@RequiereModulo` implica `@RequiereSucursal`).
 */
@Injectable()
export class ModuloInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  async intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Promise<Observable<unknown>> {
    if (contexto.getType() !== 'http') return siguiente.handle();
    const modulo = this.reflector.getAllAndOverride<Modulo | undefined>(REQUIERE_MODULO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (modulo === undefined) return siguiente.handle();

    const sucursalId = principalActual()?.sucursalId ?? null;
    if (sucursalId === null) {
      throw new ErrorAplicacion(409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para continuar');
    }
    const incluidos = await this.suscripciones.modulosDeSucursal(sucursalId);
    if (!incluidos.includes(modulo)) {
      throw new ErrorAplicacion(
        403,
        'MODULO_NO_INCLUIDO',
        'El plan de la sucursal no incluye esta función',
      );
    }
    return siguiente.handle();
  }
}
