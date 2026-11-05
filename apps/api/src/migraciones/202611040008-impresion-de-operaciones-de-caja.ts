// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C6 (criterio 96): lo que la apertura y cada movimiento
// dijeron de su impresión, para que la réplica por `id` (otra clave, otra sesión) devuelva exactamente lo mismo.
//
// - `turno.apertura_impresion` (`EN_COLA` o `SIN_IMPRESORA`) y `turno.apertura_trabajo_id` (el trabajo `GAVETA` de la
//   apertura): nulos si el fondo fue `0.00` (no hay nada que abrir).
// - `movimiento_caja.impresion` y `movimiento_caja.trabajo_impresion_id`: igual para el trabajo `GAVETA` del movimiento.
//
// `impresion` es `EN_COLA` si y solo si hay trabajo; llaves foráneas compuestas con `empresa_id` hacia
// `trabajo_impresion`. No cambia la RLS ni los privilegios. No escribe datos. `down` deshace solo lo suyo.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE turno
  ADD COLUMN apertura_impresion text CHECK (apertura_impresion IN ('EN_COLA', 'SIN_IMPRESORA')),
  ADD COLUMN apertura_trabajo_id uuid,
  ADD CONSTRAINT turno_apertura_trabajo_fk
    FOREIGN KEY (apertura_trabajo_id, empresa_id) REFERENCES trabajo_impresion (id, empresa_id),
  ADD CONSTRAINT turno_apertura_impresion_ck CHECK (
    (apertura_impresion = 'EN_COLA') = (apertura_trabajo_id IS NOT NULL)
    AND (apertura_impresion IS NOT NULL OR apertura_trabajo_id IS NULL));

ALTER TABLE movimiento_caja
  ADD COLUMN impresion text CHECK (impresion IN ('EN_COLA', 'SIN_IMPRESORA')),
  ADD COLUMN trabajo_impresion_id uuid,
  ADD CONSTRAINT movimiento_caja_trabajo_fk
    FOREIGN KEY (trabajo_impresion_id, empresa_id) REFERENCES trabajo_impresion (id, empresa_id),
  ADD CONSTRAINT movimiento_caja_impresion_ck CHECK (
    (impresion = 'EN_COLA') = (trabajo_impresion_id IS NOT NULL)
    AND (impresion IS NOT NULL OR trabajo_impresion_id IS NULL));
`;

const SQL_DOWN = `
ALTER TABLE movimiento_caja
  DROP CONSTRAINT movimiento_caja_impresion_ck,
  DROP CONSTRAINT movimiento_caja_trabajo_fk,
  DROP COLUMN trabajo_impresion_id,
  DROP COLUMN impresion;

ALTER TABLE turno
  DROP CONSTRAINT turno_apertura_impresion_ck,
  DROP CONSTRAINT turno_apertura_trabajo_fk,
  DROP COLUMN apertura_trabajo_id,
  DROP COLUMN apertura_impresion;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
