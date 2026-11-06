// Historia 006 · caja, cobro y comprobantes, entrega 6b, ataque adversarial ronda 2 (criterio 159). Dueño: facturación
// (`comprobante`).
//
// - `pdf_intentado_en` (H3): el último intento del barrido por armar el PDF del comprobante. El barrido ofrece primero los
//   que nunca se intentaron (los aceptados nuevos) y después los de intento más antiguo, así que ninguna cantidad de PDF
//   que fallan siempre bloquea a los nuevos ni deja a alguno excluido para siempre, con una o varias instancias del worker
//   (el barrido reclama el lote con `FOR UPDATE SKIP LOCKED`). El recuerdo ya no vive en la memoria del proceso. El
//   privilegio es por columna, solo esta: `restaurante_api` sigue sin poder tocar montos, serie ni número.
//
// Ninguna migración escribe datos de clientes. Las migraciones están exentas de la regla de ESLint de los nombres de
// funciones del contexto.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE comprobante ADD COLUMN pdf_intentado_en timestamptz;
GRANT UPDATE (pdf_intentado_en) ON comprobante TO restaurante_api;
CREATE INDEX comprobante_sin_pdf_idx ON comprobante (empresa_id, pdf_intentado_en NULLS FIRST, emitido_en DESC, id)
  WHERE pdf_clave IS NULL AND estado IN ('ACEPTADO', 'ANULADO');
`;

const SQL_DOWN = `
DROP INDEX comprobante_sin_pdf_idx;
REVOKE UPDATE (pdf_intentado_en) ON comprobante FROM restaurante_api;
ALTER TABLE comprobante DROP COLUMN pdf_intentado_en;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
