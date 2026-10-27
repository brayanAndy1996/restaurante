import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { requisitoPermiso, type Accion } from '@restaurante/dominio';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { principalActual } from '../../nucleo/principal';
import { AutorizacionService, autorizacionInvalida } from './autorizacion.service';

/** Metadato de `@Permiso` (se define aquí para que el decorador y el interceptor no se importen entre sí). */
export const PERMISO = 'permiso';

/**
 * Aplica `@Permiso(accion)` (criterio 48) con el rol de la persona en la sucursal activa y la matriz de
 * `packages/dominio`:
 *
 * - `prohibido`: 403 `PROHIBIDO`.
 * - `permitido`: sigue, sin autorización.
 * - `clave`: exige la cabecera `X-Autorizacion` (403 `CLAVE_REQUERIDA` si falta) y consume la autorización
 *   con `AutorizacionService.consumir` (403 `AUTORIZACION_INVALIDA` si no sirve).
 *
 * Corre dentro de la transacción de empresa del controlador (después del interceptor de contexto), así que
 * el consumo y la fila de auditoría de la acción se confirman o se revierten junto con ella: si la acción
 * falla, la autorización sigue disponible hasta que venza (criterio 50). Las sesiones de soporte y de
 * prueba son Administrador: todo les es `permitido`.
 */
@Injectable()
export class PermisoInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AutorizacionService) private readonly autorizaciones: AutorizacionService,
  ) {}

  async intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Promise<Observable<unknown>> {
    if (contexto.getType() !== 'http') return siguiente.handle();
    const accion = this.reflector.getAllAndOverride<Accion | undefined>(PERMISO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (accion === undefined) return siguiente.handle();

    const rol = principalActual()?.rol ?? null;
    // Sin rol (todavía no eligió sucursal y no es Administrador) no hay requisito que evaluar.
    if (rol === null) {
      throw new ErrorAplicacion(409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para continuar');
    }
    const requisito = requisitoPermiso(rol, accion);
    if (requisito === 'prohibido') {
      throw new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');
    }
    if (requisito === 'clave') {
      const peticion = contexto.switchToHttp().getRequest<Request>();
      const cabecera = peticion.headers['x-autorizacion'];
      if (cabecera === undefined || cabecera === '') {
        throw new ErrorAplicacion(
          403,
          'CLAVE_REQUERIDA',
          'Esta acción necesita la clave de un supervisor',
        );
      }
      if (typeof cabecera !== 'string') throw autorizacionInvalida();
      await this.autorizaciones.consumir({ autorizacionId: cabecera.trim(), accion });
    }
    return siguiente.handle();
  }
}
