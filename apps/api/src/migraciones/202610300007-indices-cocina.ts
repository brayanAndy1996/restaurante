// Historia 004 · salón y cocina, revisión de la entrega 3a (I1 y M3): índices para que `GET /cocina/comandas` no
// recorra el historial de la sucursal.
//
// El KDS se arma en dos partes. Las pendientes salen de los dos índices parciales: las líneas sin terminar y las
// comandas de marcha o anulación todavía no vistas. Las recientes (la última hora, hasta 30) se buscan por su
// última actividad, `greatest(creado_en, vista_en, max(comanda_linea.estado_en))`, así que hacen falta también los
// instantes de los últimos cambios de las líneas y de las vistas.
//
// - `comanda_linea (comanda_id) WHERE estado IN ('ENVIADO', 'EN_PREPARACION')`: el "alguna línea sin terminar".
// - `comanda (sucursal_id) WHERE vista_en IS NULL AND tipo IN ('MARCHAR', 'ANULACION')`: lo no visto.
// - `comanda_linea (empresa_id, estado_en)`: las líneas que cambiaron en la última hora (recientes).
// - `comanda (sucursal_id, vista_en) WHERE vista_en IS NOT NULL`: las comandas vistas en la última hora.
//
// Solo índices: no cambian tablas, RLS ni privilegios. `down` los borra.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
CREATE INDEX comanda_linea_pendiente_idx ON comanda_linea (comanda_id)
  WHERE estado IN ('ENVIADO', 'EN_PREPARACION');
CREATE INDEX comanda_no_vista_idx ON comanda (sucursal_id)
  WHERE vista_en IS NULL AND tipo IN ('MARCHAR', 'ANULACION');
CREATE INDEX comanda_linea_estado_en_idx ON comanda_linea (empresa_id, estado_en);
CREATE INDEX comanda_vista_idx ON comanda (sucursal_id, vista_en) WHERE vista_en IS NOT NULL;
`;

const SQL_DOWN = `
DROP INDEX comanda_vista_idx;
DROP INDEX comanda_linea_estado_en_idx;
DROP INDEX comanda_no_vista_idx;
DROP INDEX comanda_linea_pendiente_idx;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
