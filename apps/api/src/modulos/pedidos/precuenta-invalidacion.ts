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

/**
 * Lo que cambia en la orden cuando cambia su cuenta sin tocar sus ítems (historia 006, criterio 44: un descuento o
 * una cortesía, aplicados o quitados): sube `orden.version` y, si estaba en pre-cuenta, la devuelve a `ABIERTA` e
 * invalida la pre-cuenta vigente, como una anulación (004, criterio 40). Devuelve si estaba en pre-cuenta (entonces
 * también cambió la mesa).
 */
export async function cambiarLaCuenta(
  conexion: Sequelize,
  ordenId: string,
  estado: string,
  ahora: Date,
): Promise<boolean> {
  await conexion.query(
    `UPDATE orden
        SET version = version + 1,
            estado = CASE WHEN estado = 'EN_PRECUENTA' THEN 'ABIERTA' ELSE estado END,
            actualizado_en = $2
      WHERE id = $1`,
    { bind: [ordenId, ahora] },
  );
  const estabaEnPrecuenta = estado === 'EN_PRECUENTA';
  if (estabaEnPrecuenta) await invalidarPrecuentaVigente(conexion, ordenId, ahora);
  return estabaEnPrecuenta;
}
