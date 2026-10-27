import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { mergeMap, of, type Observable } from 'rxjs';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../base-de-datos/token-api';
import { estadoActual } from '../base-de-datos/estado-operacion';
import { ContextoEmpresa } from '../contexto-empresa';
import { ErrorAplicacion } from '../errores/error-aplicacion';
import { principalActual } from '../principal';
import { RELOJ, type Reloj } from '../reloj';
import { leerClaveIdempotencia } from './clave';
import { RETENCION_IDEMPOTENCIA_MS, huellaDeEntrada } from './huella';

/**
 * Idempotencia de las escrituras de empresa que llevan `@Idempotente()` (RNF-10, criterios 85 y 86). Corre
 * dentro de la transacción del controlador (después del interceptor de contexto): reserva la clave con
 * `INSERT … ON CONFLICT DO NOTHING`; si la reservó, deja correr el controlador y guarda su respuesta en
 * la misma transacción; si no, espera a la otra transacción (el `INSERT` se bloquea sobre la fila sin
 * confirmar), lee la fila y devuelve la respuesta guardada si la huella de la entrada (ruta, actor y
 * cuerpo canónico) coincide, o responde 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` si no. Las respuestas de
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
    const ruta = `${peticion.method} ${peticion.route?.path ?? peticion.path}`;
    const huella = huellaDeEntrada(ruta, actor, peticion.body);
    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();

    await this.conexion.query('DELETE FROM idempotencia WHERE creado_en < $1', {
      bind: [new Date(ahora.getTime() - RETENCION_IDEMPOTENCIA_MS)],
    });
    const nuevas = await this.conexion.query<{ id: string }>(
      `INSERT INTO idempotencia (empresa_id, clave, ruta, actor, huella_entrada, estado, creado_en)
       VALUES ($1, $2, $3, $4, $5, 'en_curso', $6)
       ON CONFLICT (empresa_id, clave) DO NOTHING
       RETURNING id`,
      { bind: [empresaId, clave, ruta, actor, huella, ahora], type: QueryTypes.SELECT },
    );

    if (nuevas.length === 0) {
      const filas = await this.conexion.query<{
        huella_entrada: string;
        ruta: string;
        actor: string;
        estado: string;
        respuesta: unknown;
      }>(
        'SELECT huella_entrada, ruta, actor, estado, respuesta FROM idempotencia WHERE clave = $1',
        { bind: [clave], type: QueryTypes.SELECT },
      );
      const fila = filas[0];
      if (
        fila === undefined ||
        fila.huella_entrada !== huella ||
        fila.ruta !== ruta ||
        fila.actor !== actor
      ) {
        throw new ErrorAplicacion(
          422,
          'CLAVE_IDEMPOTENCIA_REUTILIZADA',
          'La clave de idempotencia ya se usó con otra petición',
        );
      }
      if (fila.estado !== 'completada') {
        throw new ErrorAplicacion(409, 'CONFLICTO', 'La operación con esa clave sigue en curso');
      }
      // El estado HTTP de la respuesta es el de la ruta (`@HttpCode` o 201 en POST), el mismo de la primera vez.
      return of(fila.respuesta);
    }

    const estadoHttp: number =
      Reflect.getMetadata(HTTP_CODE_METADATA, contexto.getHandler()) ??
      (peticion.method === 'POST' ? 201 : 200);
    return siguiente.handle().pipe(
      mergeMap(async (cuerpo: unknown) => {
        // La API no tiene `UPDATE` sobre `idempotencia` (solo `SELECT`, `INSERT` y `DELETE`): la fila
        // `en_curso` se reemplaza por la `completada` en la misma transacción. Quien esperaba la clave
        // la encuentra ya completada al confirmarse.
        await this.conexion.query('DELETE FROM idempotencia WHERE clave = $1', { bind: [clave] });
        await this.conexion.query(
          `INSERT INTO idempotencia (empresa_id, clave, ruta, actor, huella_entrada, estado,
                                     estado_http, respuesta, creado_en)
           VALUES ($1, $2, $3, $4, $5, 'completada', $6, $7::jsonb, $8)`,
          {
            bind: [
              empresaId,
              clave,
              ruta,
              actor,
              huella,
              estadoHttp,
              JSON.stringify(cuerpo ?? null),
              ahora,
            ],
          },
        );
        return cuerpo;
      }),
    );
  }
}
