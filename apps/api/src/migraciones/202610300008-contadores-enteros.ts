// Historia 004 · salón y cocina, ataque adversarial (ronda 2): los contadores por orden pasan de `smallint` a
// `integer`.
//
// `envio.numero` y `precuenta.numero` se calculan como `max(numero) + 1` por orden. Con `smallint`, la orden número
// 32 768 desbordaba con un error de base de datos (500) en vez de un envío o una pre-cuenta. Una orden de larga vida
// (un evento, una mesa que no se cierra) no llega ahí por uso normal, pero el tope no debe depender de la columna.
//
// No hay otro contador en `smallint` en el módulo: `comanda` no tiene número, `item.posicion` es el índice dentro de
// un envío (acotado por `MAXIMO_LINEAS_ENVIO`), y el resto de las columnas `smallint` tienen un CHECK con tope
// pequeño (comensales, tiempo, cantidad de un componente, tamaño del plano).
//
// No cambia ningún CHECK, índice (los únicos `envio_numero_unico` y `precuenta_numero_unico` se reconstruyen con la
// columna), política RLS, privilegio ni trigger. No escribe datos.
//
// `down` vuelve a `smallint`. Si algún número ya no cabe, la reversión se detiene con un error claro en vez de
// truncar datos.
import type { ContextoMigracion } from './tipos';

const COLUMNAS: readonly (readonly [tabla: string, columna: string])[] = [
  ['envio', 'numero'],
  ['precuenta', 'numero'],
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
