import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * Marca como invalidada la pre-cuenta vigente de una orden cuando esta cambia (historia 004, criterios 23, 40 y
 * 53): `precuenta.invalidada_en = ahora`. Las demás pre-cuentas ya están invalidadas. La tabla `precuenta` llega
 * con la migración de las anulaciones y pre-cuentas (T22); hasta entonces ninguna orden puede estar en
 * pre-cuenta y esto no hace nada (consulta el catálogo en lugar de fallar con "la relación no existe", que
 * abortaría la transacción). Quien lo llama sube además `orden.version` y devuelve la orden a `ABIERTA`.
 */
export async function invalidarPrecuentaVigente(
  conexion: Sequelize,
  ordenId: string,
  ahora: Date,
): Promise<void> {
  const [existe] = await conexion.query<{ existe: boolean }>(
    `SELECT to_regclass('public.precuenta') IS NOT NULL AS existe`,
    { type: QueryTypes.SELECT },
  );
  if (existe?.existe !== true) return;
  await conexion.query(
    `UPDATE precuenta SET invalidada_en = $2, actualizado_en = $2
      WHERE orden_id = $1 AND invalidada_en IS NULL`,
    { bind: [ordenId, ahora] },
  );
}
