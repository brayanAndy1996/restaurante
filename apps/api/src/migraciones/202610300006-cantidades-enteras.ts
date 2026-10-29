// Historia 004 · salón y cocina, ataque adversarial (ronda 1, F1): las cantidades de los pedidos pasan de
// `smallint` a `integer`.
//
// El contrato permite líneas de 999 y componentes de combo de hasta 99 por ítem, así que la cantidad de una parte
// llega a 99 × 999 = 98 901, que no cabe en `smallint` (máximo 32 767). Peor: en PostgreSQL `smallint * smallint`
// es `smallint`, así que `cantidad_por_item * (cantidad - cantidad_anulada)` del KDS desbordaba antes de cualquier
// cast, y la marcha y las anulaciones guardan esa cantidad en `comanda_linea.cantidad`.
//
// - `comanda_linea.cantidad_por_item` y `comanda_linea.cantidad`: las que se multiplican y se guardan fijas.
// - `item.cantidad` y `item.cantidad_anulada`: los factores de esa multiplicación y de todo monto; sus CHECK (1 a
//   999) no cambian, pero así ninguna operación entre columnas puede desbordar.
// - `anulacion_item.cantidad`: la cantidad anulada, que se suma a `item.cantidad_anulada`.
//
// No cambia ningún CHECK, índice, política RLS, privilegio ni trigger. Ninguna migración escribe datos.
//
// `down` vuelve a `smallint`. Si alguna cantidad ya no cabe (una línea guardada con más de 32 767) la reversión se
// detiene con un error claro en vez de truncar datos.
import type { ContextoMigracion } from './tipos';

const COLUMNAS: readonly (readonly [tabla: string, columna: string])[] = [
  ['comanda_linea', 'cantidad_por_item'],
  ['comanda_linea', 'cantidad'],
  ['item', 'cantidad'],
  ['item', 'cantidad_anulada'],
  ['anulacion_item', 'cantidad'],
];

const SQL_UP = COLUMNAS.map(
  ([tabla, columna]) => `ALTER TABLE ${tabla} ALTER COLUMN ${columna} TYPE integer;`,
).join('\n');

const SQL_COMPROBAR_DOWN = `
DO $$
BEGIN
${COLUMNAS.map(
  ([tabla, columna]) => `  IF EXISTS (SELECT 1 FROM ${tabla} WHERE ${columna} > 32767) THEN
    RAISE EXCEPTION 'No se puede revertir: ${tabla}.${columna} tiene valores que no caben en smallint';
  END IF;`,
).join('\n')}
END $$;
`;

const SQL_DOWN =
  SQL_COMPROBAR_DOWN +
  COLUMNAS.map(
    ([tabla, columna]) => `ALTER TABLE ${tabla} ALTER COLUMN ${columna} TYPE smallint;`,
  ).join('\n');

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
