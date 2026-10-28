import { QueryTypes, type Sequelize } from 'sequelize';
import { ErrorAplicacion } from '../errores/error-aplicacion';
import { RETENCION_IDEMPOTENCIA_MS } from './huella';

/** Datos que identifican una petición idempotente de empresa (criterios 85 y 86). */
export interface PeticionIdempotente {
  empresaId: string;
  /** Valor ya validado de `Idempotency-Key`. */
  clave: string;
  /** Ruta concreta, con sus parámetros (`POST /usuarios/<id>/contrasena`), no el patrón de la ruta. */
  ruta: string;
  /** `usuario:<id>`, `superadministrador:<id>` o `prueba`. */
  actor: string;
  /** Huella de la entrada (`huellaDeEntrada`). */
  huella: string;
  /** Hora de la API (reloj inyectable). */
  ahora: Date;
}

/**
 * Resultado de reservar la clave: `nueva` (el llamador debe ejecutar la operación y llamar a
 * `completarClave`), `completada` (la misma petición ya se resolvió: devolver su respuesta guardada) o
 * `rechazada` (otra petición usó la clave, o la misma sigue en curso: lanzar o devolver el error).
 */
export type ReservaClave =
  | { tipo: 'nueva' }
  | { tipo: 'completada'; respuesta: unknown }
  | { tipo: 'rechazada'; error: ErrorAplicacion };

/**
 * Reserva la clave de idempotencia en la transacción de empresa en curso (usa `conexion`, la de la API,
 * con la transacción del contexto activo): borra las claves vencidas y hace `INSERT … ON CONFLICT DO
 * NOTHING`. Si otra transacción la tiene reservada y sin confirmar, el `INSERT` espera a que termine.
 * Es la única implementación: la usan `IdempotenciaInterceptor` y la clave de supervisor.
 */
export async function reservarClave(
  conexion: Sequelize,
  peticion: PeticionIdempotente,
): Promise<ReservaClave> {
  const { empresaId, clave, ruta, actor, huella, ahora } = peticion;
  await conexion.query('DELETE FROM idempotencia WHERE creado_en < $1', {
    bind: [new Date(ahora.getTime() - RETENCION_IDEMPOTENCIA_MS)],
  });
  const nuevas = await conexion.query<{ id: string }>(
    `INSERT INTO idempotencia (empresa_id, clave, ruta, actor, huella_entrada, estado, creado_en)
     VALUES ($1, $2, $3, $4, $5, 'en_curso', $6)
     ON CONFLICT (empresa_id, clave) DO NOTHING
     RETURNING id`,
    { bind: [empresaId, clave, ruta, actor, huella, ahora], type: QueryTypes.SELECT },
  );
  if (nuevas.length > 0) return { tipo: 'nueva' };

  const filas = await conexion.query<{
    huella_entrada: string;
    ruta: string;
    actor: string;
    estado: string;
    respuesta: unknown;
  }>('SELECT huella_entrada, ruta, actor, estado, respuesta FROM idempotencia WHERE clave = $1', {
    bind: [clave],
    type: QueryTypes.SELECT,
  });
  const fila = filas[0];
  if (
    fila === undefined ||
    fila.huella_entrada !== huella ||
    fila.ruta !== ruta ||
    fila.actor !== actor
  ) {
    return {
      tipo: 'rechazada',
      error: new ErrorAplicacion(
        422,
        'CLAVE_IDEMPOTENCIA_REUTILIZADA',
        'La clave de idempotencia ya se usó con otra petición',
      ),
    };
  }
  if (fila.estado !== 'completada') {
    return {
      tipo: 'rechazada',
      error: new ErrorAplicacion(409, 'CONFLICTO', 'La operación con esa clave sigue en curso'),
    };
  }
  return { tipo: 'completada', respuesta: fila.respuesta };
}

/**
 * Guarda la respuesta de la operación. La API no tiene `UPDATE` sobre `idempotencia` (solo `SELECT`,
 * `INSERT` y `DELETE`): la fila `en_curso` se reemplaza por la `completada` en la misma transacción.
 * Quien esperaba la clave la encuentra ya completada al confirmarse.
 */
export async function completarClave(
  conexion: Sequelize,
  peticion: PeticionIdempotente,
  estadoHttp: number,
  respuesta: unknown,
): Promise<void> {
  const { empresaId, clave, ruta, actor, huella, ahora } = peticion;
  await conexion.query('DELETE FROM idempotencia WHERE clave = $1', { bind: [clave] });
  await conexion.query(
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
        JSON.stringify(respuesta ?? null),
        ahora,
      ],
    },
  );
}

/** Libera la clave reservada (una respuesta de error no se guarda: la clave queda libre para reintentar). */
export async function liberarClave(conexion: Sequelize, clave: string): Promise<void> {
  await conexion.query('DELETE FROM idempotencia WHERE clave = $1', { bind: [clave] });
}
