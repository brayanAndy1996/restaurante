import { QueryTypes, type Sequelize } from 'sequelize';
import { SQL_SALUD, type OpcionesSinEmpresa } from './consultas-sin-empresa';

/** Tiempo máximo de la comprobación de salud (el criterio 6 pide responder en menos de 3 s). */
export const TIEMPO_LIMITE_SALUD_MS = 2_000;

/**
 * Ejecuta `SELECT 1` por la conexión indicada, marcado `sinEmpresa: 'salud'`. Devuelve `true` si la
 * base responde y `false` si falla o no responde a tiempo (conexión rechazada, credenciales
 * inválidas, base apagada o pool agotado). Nunca lanza ni expone el motivo del fallo.
 */
export async function comprobarConexion(
  sequelize: Sequelize,
  tiempoLimiteMs: number = TIEMPO_LIMITE_SALUD_MS,
): Promise<boolean> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<false>((resolver) => {
    temporizador = setTimeout(() => resolver(false), tiempoLimiteMs);
  });
  const opciones: OpcionesSinEmpresa = { type: QueryTypes.SELECT, sinEmpresa: 'salud' };
  const consulta = sequelize.query(SQL_SALUD, opciones).then(
    () => true as const,
    () => false as const,
  );
  try {
    return await Promise.race([consulta, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}
