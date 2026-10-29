// Historia 004 · salón y cocina, ataque adversarial (ronda 2): el índice de las líneas pendientes del KDS se acota por
// empresa y deja fuera las líneas de marcha y anulación.
//
// `comanda_linea_pendiente_idx` (202610300007) era `(comanda_id) WHERE estado IN ('ENVIADO', 'EN_PREPARACION')`. Tenía
// dos problemas:
//
// - Sin la empresa, `GET /cocina/comandas` recorría las líneas sin terminar de todas las empresas antes de que la RLS
//   descartara las ajenas. Con `empresa_id` como primera columna, la consulta (y el filtro de la RLS) entran por la
//   empresa y su costo depende de las líneas pendientes de esa empresa.
// - Las líneas de las comandas `MARCHAR` y `ANULACION` nunca salen de `ENVIADO` (esas comandas se marcan vistas, no
//   listas), así que se quedaban para siempre en el índice parcial y lo hacían crecer con el historial. Solo esas
//   líneas guardan una cantidad fija (`cantidad IS NOT NULL`; las de `COMANDA` y `ADICION` la calculan del ítem), así
//   que `cantidad IS NULL` las deja fuera sin cambiar lo que ve la pantalla: las comandas de marcha y anulación
//   pendientes salen de `comanda_no_vista_idx`, no de sus líneas.
//
// Solo cambia un índice: no toca tablas, RLS ni privilegios. `down` deja el índice de 202610300007.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
DROP INDEX comanda_linea_pendiente_idx;
CREATE INDEX comanda_linea_pendiente_idx ON comanda_linea (empresa_id, comanda_id)
  WHERE estado IN ('ENVIADO', 'EN_PREPARACION') AND cantidad IS NULL;
`;

const SQL_DOWN = `
DROP INDEX comanda_linea_pendiente_idx;
CREATE INDEX comanda_linea_pendiente_idx ON comanda_linea (comanda_id)
  WHERE estado IN ('ENVIADO', 'EN_PREPARACION');
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
