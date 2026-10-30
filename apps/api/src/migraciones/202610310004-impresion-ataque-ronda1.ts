// Historia 004 · salón y cocina, entrega 3b, ronda 1 del ataque y de la revisión (fallas F1, F3 y hallazgo M8):
// los trabajos que no se pueden armar y la unicidad de la pre-cuenta.
//
// - `trabajo_impresion.error_render` (F1): por qué el ticket de un trabajo no se pudo armar (el documento guardado no
//   cumple `documentoTicketSchema`, o el renderizador falló al entregarlo). Nulo mientras el trabajo se puede
//   imprimir. Un trabajo con `error_render` sigue `PENDIENTE` pero no se entrega, no ocupa lugar en la entrega del
//   puente ni cuenta como pendiente de su impresora (no lo arregla que la impresora vuelva), y la lista de "Trabajos
//   de hoy" lo muestra con su error. Se puede reimprimir. Máximo 200 caracteres, como `ultimo_error`.
// - `trabajo_impresion_precuenta_unico` (M8): un solo trabajo de emisión por pre-cuenta. Las reimpresiones llevan
//   `reimpresion_de_id` y quedan fuera, como en el índice único por comanda de la migración `202610310002`. Empieza
//   por `empresa_id`, como todos los únicos. Es la red de seguridad contra dos peticiones que emitan a la vez el
//   trabajo de la misma pre-cuenta; la API ya devuelve el trabajo de la emisión en vez de crear otro.
// - `trabajo_impresion_entrega_idx` (F3): la entrega del puente toma, por impresora, los más antiguos que se pueden
//   imprimir (`PENDIENTE`, sin `error_render`). Reemplaza a `trabajo_impresion_impresora_idx`, que solo servía para
//   contar los pendientes: este sirve para eso y para ordenar por creación dentro de cada impresora.
//
// No cambia la RLS, el trigger de trazabilidad ni los privilegios (la tabla ya concede SELECT, INSERT y UPDATE a
// `restaurante_api`). No escribe datos. `down` revierte los tres cambios y se puede volver a migrar.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE trabajo_impresion
  ADD COLUMN error_render text CHECK (error_render IS NULL OR char_length(error_render) <= 200);

CREATE UNIQUE INDEX trabajo_impresion_precuenta_unico ON trabajo_impresion (empresa_id, precuenta_id)
  WHERE precuenta_id IS NOT NULL AND reimpresion_de_id IS NULL;

DROP INDEX trabajo_impresion_impresora_idx;
CREATE INDEX trabajo_impresion_entrega_idx
  ON trabajo_impresion (empresa_id, impresora_id, creado_en, id)
  WHERE estado = 'PENDIENTE' AND error_render IS NULL;
`;

const SQL_DOWN = `
DROP INDEX trabajo_impresion_entrega_idx;
CREATE INDEX trabajo_impresion_impresora_idx ON trabajo_impresion (empresa_id, impresora_id)
  WHERE estado = 'PENDIENTE';

DROP INDEX trabajo_impresion_precuenta_unico;

ALTER TABLE trabajo_impresion DROP COLUMN error_render;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
