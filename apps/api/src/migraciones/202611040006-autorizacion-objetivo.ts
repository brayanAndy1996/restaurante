// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C3 (criterio 40, pregunta 9, plan "Migraciones" 6): la
// clave de supervisor queda atada a lo que autoriza.
//
// - `autorizacion.objetivo` (jsonb, nulo): lo que el supervisor vio al dar su clave (`{ tipo: 'DESCUENTO', ordenId,
//   itemId, descuento: { tipo, valor } }` o `{ tipo: 'CORTESIA', ordenId, itemId, cantidad }`), ya normalizado (ids en
//   minúsculas y `valor` con 2 decimales). Sin él, la clave vale para la acción como hasta ahora (002). Las rutas de
//   descuentos y cortesías comparan este objetivo con el de su cuerpo; el consumo de 002 no cambia.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE autorizacion
  ADD COLUMN objetivo jsonb,
  ADD CONSTRAINT autorizacion_objetivo_ck CHECK (objetivo IS NULL OR jsonb_typeof(objetivo) = 'object');
`;

const SQL_DOWN = `
ALTER TABLE autorizacion
  DROP CONSTRAINT autorizacion_objetivo_ck,
  DROP COLUMN objetivo;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
