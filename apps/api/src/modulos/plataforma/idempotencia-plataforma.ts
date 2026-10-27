import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { RETENCION_IDEMPOTENCIA_MS, huellaDeEntrada } from '../../nucleo/idempotencia/huella';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import type { IdempotenciaPlataforma } from './tipos';

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

/** Estado HTTP que se guarda con la respuesta: las operaciones idempotentes de plataforma son altas (201). */
const ESTADO_HTTP_ALTA = 201;

/**
 * Reserva la clave de idempotencia de una operación de plataforma dentro de su transacción (criterios
 * 85 y 86; la tabla `idempotencia_plataforma` es de plataforma). Devuelve `null` si la clave es nueva (la
 * operación debe correr y guardar su respuesta con `guardarRespuesta`) o la respuesta guardada si ya hubo
 * una con la misma ruta, el mismo actor y el mismo cuerpo. La misma clave con otra cosa responde 422
 * `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Una operación concurrente con la misma clave espera a que la otra
 * termine (el `INSERT … ON CONFLICT` se bloquea sobre la fila sin confirmar) y devuelve su respuesta.
 * Borra al pasar las claves de más de 24 horas.
 */
export async function reservarClave(
  transaccion: Transaction,
  idempotencia: IdempotenciaPlataforma,
  ahora: Date,
): Promise<{ respuesta: unknown } | null> {
  const sequelize = sequelizeDe(transaccion);
  const huella = huellaDeEntrada(idempotencia.ruta, idempotencia.actor, idempotencia.cuerpo);
  await sequelize.query('DELETE FROM idempotencia_plataforma WHERE creado_en < $1', {
    transaction: transaccion,
    bind: [new Date(ahora.getTime() - RETENCION_IDEMPOTENCIA_MS)],
  });
  const nuevas = await sequelize.query<{ id: string }>(
    `INSERT INTO idempotencia_plataforma (clave, ruta, actor, huella_entrada, estado, creado_en)
     VALUES ($1, $2, $3, $4, 'en_curso', $5)
     ON CONFLICT (clave) DO NOTHING
     RETURNING id`,
    {
      transaction: transaccion,
      bind: [idempotencia.clave, idempotencia.ruta, idempotencia.actor, huella, ahora],
      type: QueryTypes.SELECT,
    },
  );
  if (nuevas.length > 0) return null;

  const filas = await sequelize.query<{
    ruta: string;
    actor: string;
    huella_entrada: string;
    estado: string;
    respuesta: unknown;
  }>(
    'SELECT ruta, actor, huella_entrada, estado, respuesta FROM idempotencia_plataforma WHERE clave = $1',
    { transaction: transaccion, bind: [idempotencia.clave], type: QueryTypes.SELECT },
  );
  const fila = filas[0];
  if (
    fila === undefined ||
    fila.huella_entrada !== huella ||
    fila.ruta !== idempotencia.ruta ||
    fila.actor !== idempotencia.actor
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
  return { respuesta: fila.respuesta };
}

/**
 * Guarda la respuesta de la operación que reservó la clave, en la misma transacción. La tabla solo da
 * `SELECT`, `INSERT` y `DELETE`: la fila `en_curso` se reemplaza por la `completada`.
 */
export async function guardarRespuesta(
  transaccion: Transaction,
  idempotencia: IdempotenciaPlataforma,
  respuesta: unknown,
  ahora: Date,
): Promise<void> {
  const sequelize = sequelizeDe(transaccion);
  await sequelize.query('DELETE FROM idempotencia_plataforma WHERE clave = $1', {
    transaction: transaccion,
    bind: [idempotencia.clave],
  });
  await sequelize.query(
    `INSERT INTO idempotencia_plataforma (clave, ruta, actor, huella_entrada, estado, estado_http,
                                          respuesta, creado_en)
     VALUES ($1, $2, $3, $4, 'completada', $5, $6::jsonb, $7)`,
    {
      transaction: transaccion,
      bind: [
        idempotencia.clave,
        idempotencia.ruta,
        idempotencia.actor,
        huellaDeEntrada(idempotencia.ruta, idempotencia.actor, idempotencia.cuerpo),
        ESTADO_HTTP_ALTA,
        JSON.stringify(respuesta ?? null),
        ahora,
      ],
    },
  );
}
