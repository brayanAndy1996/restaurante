// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C6 (criterios 90 a 96, plan "Migraciones" 7): los
// trabajos de impresión de caja. Dueño: impresión.
//
// - `trabajo_impresion.tipo` gana `COMPROBANTE`, `REPORTE_X`, `REPORTE_Z` y `GAVETA` (el ticket del comprobante, el
//   reporte X, la Z del cierre y el pulso solo de la gaveta).
// - `comprobante_id` (nulo): el comprobante de un trabajo `COMPROBANTE`; `turno_id` (nulo): el turno de un
//   `REPORTE_X`, un `REPORTE_Z` o un `GAVETA`. Llaves foráneas compuestas con `empresa_id`, como las demás. Un trabajo
//   es de una sola cosa (comanda, pre-cuenta, comprobante o turno) y cada columna solo existe con sus tipos.
// - Únicos parciales: un `COMPROBANTE` por comprobante (criterio 90) y un `REPORTE_Z` por turno (criterio 95), sin
//   contar las reimpresiones (llevan `reimpresion_de_id`). Son la red de seguridad contra dos peticiones que emitan
//   el mismo ticket.
// - `entregado_en` ya existe (migración `202610310002`) y sirve para que el pulso de la gaveta salga una sola vez
//   (criterio 94): no hace falta una columna nueva.
//
// No cambia la RLS, el trigger de trazabilidad ni los privilegios (la tabla ya concede SELECT, INSERT y UPDATE a
// `restaurante_api`). No escribe datos. `down` deshace solo lo suyo y falla si ya hay trabajos de los tipos nuevos.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE trabajo_impresion DROP CONSTRAINT trabajo_impresion_tipo_check;
ALTER TABLE trabajo_impresion ADD CONSTRAINT trabajo_impresion_tipo_check CHECK (tipo IN (
  'COMANDA', 'ADICION', 'MARCHAR', 'ANULACION', 'PRECUENTA', 'PRUEBA',
  'COMPROBANTE', 'REPORTE_X', 'REPORTE_Z', 'GAVETA'));

ALTER TABLE trabajo_impresion
  ADD COLUMN comprobante_id uuid,
  ADD COLUMN turno_id uuid,
  ADD CONSTRAINT trabajo_impresion_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  ADD CONSTRAINT trabajo_impresion_turno_fk
    FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id),
  ADD CONSTRAINT trabajo_impresion_caja_ck CHECK (
    (comprobante_id IS NULL OR tipo = 'COMPROBANTE')
    AND (turno_id IS NULL OR tipo IN ('REPORTE_X', 'REPORTE_Z', 'GAVETA'))
    AND (tipo <> 'COMPROBANTE' OR comprobante_id IS NOT NULL)
    AND (tipo NOT IN ('REPORTE_X', 'REPORTE_Z', 'GAVETA') OR turno_id IS NOT NULL));

-- Un trabajo es de una comanda, de una pre-cuenta, de un comprobante o de un turno, no de más de uno.
ALTER TABLE trabajo_impresion DROP CONSTRAINT trabajo_impresion_origen_ck;
ALTER TABLE trabajo_impresion ADD CONSTRAINT trabajo_impresion_origen_ck
  CHECK (num_nonnulls(comanda_id, precuenta_id, comprobante_id, turno_id) <= 1);

CREATE UNIQUE INDEX trabajo_impresion_comprobante_unico ON trabajo_impresion (empresa_id, comprobante_id)
  WHERE tipo = 'COMPROBANTE' AND reimpresion_de_id IS NULL;
CREATE UNIQUE INDEX trabajo_impresion_reporte_z_unico ON trabajo_impresion (empresa_id, turno_id)
  WHERE tipo = 'REPORTE_Z' AND reimpresion_de_id IS NULL;
CREATE INDEX trabajo_impresion_comprobante_idx ON trabajo_impresion (empresa_id, comprobante_id)
  WHERE comprobante_id IS NOT NULL;
CREATE INDEX trabajo_impresion_turno_idx ON trabajo_impresion (empresa_id, turno_id)
  WHERE turno_id IS NOT NULL;
`;

const SQL_DOWN = `
DROP INDEX trabajo_impresion_turno_idx;
DROP INDEX trabajo_impresion_comprobante_idx;
DROP INDEX trabajo_impresion_reporte_z_unico;
DROP INDEX trabajo_impresion_comprobante_unico;

ALTER TABLE trabajo_impresion DROP CONSTRAINT trabajo_impresion_origen_ck;
ALTER TABLE trabajo_impresion ADD CONSTRAINT trabajo_impresion_origen_ck
  CHECK (num_nonnulls(comanda_id, precuenta_id) <= 1);

ALTER TABLE trabajo_impresion
  DROP CONSTRAINT trabajo_impresion_caja_ck,
  DROP CONSTRAINT trabajo_impresion_turno_fk,
  DROP CONSTRAINT trabajo_impresion_comprobante_fk,
  DROP COLUMN turno_id,
  DROP COLUMN comprobante_id;

ALTER TABLE trabajo_impresion DROP CONSTRAINT trabajo_impresion_tipo_check;
ALTER TABLE trabajo_impresion ADD CONSTRAINT trabajo_impresion_tipo_check CHECK (tipo IN (
  'COMANDA', 'ADICION', 'MARCHAR', 'ANULACION', 'PRECUENTA', 'PRUEBA'));
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
