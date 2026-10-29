import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Accion } from '@restaurante/dominio';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import type { ZodType } from 'zod';
import { PipeUuid, PipeZod } from '../../nucleo/errores/pipes';
import { AutorizacionService } from './autorizacion.service';
import {
  CLAVE_DIFERIDA,
  PERMISO,
  consumirAutorizacionDeLaPeticion,
  requisitoDeLaPeticion,
} from './permiso.interceptor';

/** Lo que `ClaveDiferidaInterceptor` valida antes de consumir la autorización (la misma validación de los pipes). */
export interface ValidacionPrevia {
  /** Esquema del cuerpo (el mismo del `@Body(new PipeZod(...))` de la ruta). */
  cuerpo?: ZodType<unknown>;
  /** Parámetros de ruta que deben ser UUID (los mismos que llevan `PipeUuid`). */
  uuids?: readonly string[];
}

/**
 * Consume la autorización de supervisor de una ruta con `@ClaveDespuesDeValidar` (historia 004, "Contrato": el
 * orden de rechazos de las escrituras de órdenes). Corre después de `PermisoInterceptor` (rol), de
 * `ModuloInterceptor`, de `IdempotenciaInterceptor` (si la misma `Idempotency-Key` ya tiene respuesta guardada,
 * la devuelve y este interceptor ni se ejecuta: la réplica no consume de nuevo la autorización) y de
 * `ClaveObligatoriaInterceptor` (400 sin `Idempotency-Key`). Los pipes de Nest corren después de todos los
 * interceptores, así que aquí se valida la entrada antes de consumir (400 de forma antes que 403 de clave) con
 * los mismos esquemas de la ruta. Solo actúa si el rol de la sucursal activa necesita clave.
 *
 * El consumo corre en la transacción de la petición: si la acción falla después, se revierte (criterio 36).
 */
@Injectable()
export class ClaveDiferidaInterceptor implements NestInterceptor {
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
    const validacion = this.reflector.get<ValidacionPrevia | undefined>(
      CLAVE_DIFERIDA,
      contexto.getHandler(),
    );
    if (accion === undefined || validacion === undefined) return siguiente.handle();

    if (requisitoDeLaPeticion(accion) === 'clave') {
      const peticion = contexto.switchToHttp().getRequest<Request>();
      const uuid = new PipeUuid();
      for (const nombre of validacion.uuids ?? []) {
        uuid.transform(String(peticion.params[nombre] ?? ''));
      }
      if (validacion.cuerpo !== undefined) {
        new PipeZod(validacion.cuerpo).transform(peticion.body);
      }
      await consumirAutorizacionDeLaPeticion(peticion, this.autorizaciones, accion);
    }
    return siguiente.handle();
  }
}
