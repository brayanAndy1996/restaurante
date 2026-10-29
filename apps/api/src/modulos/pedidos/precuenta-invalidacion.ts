import { type Sequelize } from 'sequelize';

/**
 * Marca como invalidada la pre-cuenta vigente de una orden cuando esta cambia (historia 004, criterios 23, 40 y
 * 53): `precuenta.invalidada_en = ahora`. Las demás pre-cuentas ya están invalidadas. Quien lo llama sube además
 * `orden.version` y devuelve la orden a `ABIERTA`.
 */
export async function invalidarPrecuentaVigente(
  conexion: Sequelize,
  ordenId: string,
  ahora: Date,
): Promise<void> {
  await conexion.query(
    `UPDATE precuenta SET invalidada_en = $2, actualizado_en = $2
      WHERE orden_id = $1 AND invalidada_en IS NULL`,
    { bind: [ordenId, ahora] },
  );
}
