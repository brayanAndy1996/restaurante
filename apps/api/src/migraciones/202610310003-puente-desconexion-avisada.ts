// Historia 004 · salón y cocina, entrega 3b, grupo C9 (T44, criterios 120 y 121): el aviso de que el puente dejó de
// dar señal.
//
// - `puente.desconexion_avisada_en`: el instante en que la API publicó `impresion.estado` porque el puente llevaba más
//   de 60 segundos sin señal (la revisión periódica). Nulo mientras no se ha avisado esa desconexión. Cualquier señal
//   del puente (latido o socket) la vuelve a dejar en nulo y, si estaba fijada, avisa que el puente volvió. Así cada
//   cambio de estado se publica una sola vez, también con varias instancias de la API: la revisión la fija con un
//   `UPDATE … WHERE desconexion_avisada_en IS NULL` y solo publica quien lo ganó.
//
// Solo agrega una columna nula a `puente`: no cambia la RLS, el trigger de trazabilidad ni los privilegios (la
// tabla ya concede UPDATE a `restaurante_api`). No escribe datos. `down` borra la columna.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE puente ADD COLUMN desconexion_avisada_en timestamptz;
`;

const SQL_DOWN = `
ALTER TABLE puente DROP COLUMN desconexion_avisada_en;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
