import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { mergeMap, of, type Observable } from 'rxjs';
import type { Sequelize } from 'sequelize';
import { CONEXION_API } from '../base-de-datos/token-api';
import { estadoActual } from '../base-de-datos/estado-operacion';
import { ContextoEmpresa } from '../contexto-empresa';
import { principalActual } from '../principal';
import { RELOJ, type Reloj } from '../reloj';
import { leerClaveIdempotencia } from './clave';
import { CLAVE_HUELLA, huellaDeEntrada } from './huella';
import { completarClave, reservarClave, type PeticionIdempotente } from './reserva';

/**
 * Idempotencia de las escrituras de empresa que llevan `@Idempotente()` (RNF-10, criterios 85 y 86). Corre
 * dentro de la transacción del controlador (después del interceptor de contexto): reserva la clave con
 * `INSERT … ON CONFLICT DO NOTHING`; si la reservó, deja correr el controlador y guarda su respuesta en
 * la misma transacción; si no, espera a la otra transacción (el `INSERT` se bloquea sobre la fila sin
 * confirmar), lee la fila y devuelve la respuesta guardada si la huella de la entrada (ruta, actor y
 * cuerpo canónico, con HMAC y un secreto del entorno) coincide, o responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` si no. Las respuestas de
 * error no se guardan: la transacción se revierte y la clave queda libre.
 *
 * Sin `Idempotency-Key` la petición sigue como siempre; sin contexto de empresa (rutas `@SinEmpresa()`,
 * que la manejan en su servicio, y rutas de plataforma, que la manejan en `OperacionPlataforma`) no hace
 * nada. Las claves de una empresa nunca se ven desde otra: la tabla tiene RLS y la clave es única por empresa.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(CLAVE_HUELLA) private readonly claveHuella: Buffer,
  ) {}

  async intercept(
    contexto: ExecutionContext,
    siguiente: CallHandler,
  ): Promise<Observable<unknown>> {
    if (contexto.getType() !== 'http') return siguiente.handle();
    const peticion = contexto.switchToHttp().getRequest<Request>();
    const clave = leerClaveIdempotencia(peticion);
    if (clave === undefined) return siguiente.handle();
    if (estadoActual()?.empresaId === undefined) return siguiente.handle();

    const principal = principalActual();
    const actor =
      principal?.usuarioId != null
        ? `usuario:${principal.usuarioId}`
        : principal?.superadministradorId != null
          ? `superadministrador:${principal.superadministradorId}`
          : 'prueba';
    // La ruta concreta, con sus parámetros: la misma clave en `/x/1` y en `/x/2` son peticiones distintas.
    const ruta = `${peticion.method} ${peticion.path}`;
    const huella = huellaDeEntrada(this.claveHuella, ruta, actor, peticion.body);
    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();

    const peticionIdempotente: PeticionIdempotente = {
      empresaId,
      clave,
      ruta,
      actor,
      huella,
      ahora,
    };
    const reserva = await reservarClave(this.conexion, peticionIdempotente);
    if (reserva.tipo === 'rechazada') throw reserva.error;
    if (reserva.tipo === 'completada') return of(reserva.respuesta);

    // El estado HTTP de la respuesta es el de la ruta (`@HttpCode` o 201 en POST), el mismo de la primera vez.
    const estadoHttp: number =
      Reflect.getMetadata(HTTP_CODE_METADATA, contexto.getHandler()) ??
      (peticion.method === 'POST' ? 201 : 200);
    return siguiente.handle().pipe(
      mergeMap(async (cuerpo: unknown) => {
        await completarClave(this.conexion, peticionIdempotente, estadoHttp, cuerpo);
        return cuerpo;
      }),
    );
  }
}
