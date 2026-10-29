// Historia 004 · salón y cocina, grupo C2 (criterios 68 y 70): esquema del adaptador de Socket.IO.
//
// - Esquema `tiempo_real`: dueño el migrador, sin acceso para PUBLIC ni para `restaurante_api` ni
//   `restaurante_plataforma`. Solo `restaurante_tiempo_real` (el rol de `DATABASE_TIEMPO_REAL_URL`, que crea
//   `db:preparar`: los roles no se crean en migraciones) tiene `USAGE`.
// - `tiempo_real.socket_io_attachments (id, created_at, payload)`: la tabla auxiliar de
//   `@socket.io/postgres-adapter` para los mensajes que no caben en un `NOTIFY` (más de 8000 bytes, o con datos
//   binarios). El adaptador inserta, lee por id y borra los viejos; por eso el rol recibe `SELECT`, `INSERT` y
//   `DELETE` y nada de `UPDATE`. No es una tabla de clientes: no lleva `empresa_id` ni RLS, y no guarda datos de
//   negocio (los eventos llevan solo ids). `restaurante_api` y `restaurante_plataforma` no reciben nada.
//
// `down` borra el esquema.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
CREATE SCHEMA tiempo_real AUTHORIZATION restaurante_migrador;
REVOKE ALL ON SCHEMA tiempo_real FROM PUBLIC;
GRANT USAGE ON SCHEMA tiempo_real TO restaurante_tiempo_real;

CREATE TABLE tiempo_real.socket_io_attachments (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload bytea NOT NULL
);
CREATE INDEX socket_io_attachments_created_at_idx ON tiempo_real.socket_io_attachments (created_at);

REVOKE ALL ON TABLE tiempo_real.socket_io_attachments FROM PUBLIC;
REVOKE ALL ON SEQUENCE tiempo_real.socket_io_attachments_id_seq FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE tiempo_real.socket_io_attachments TO restaurante_tiempo_real;
GRANT USAGE ON SEQUENCE tiempo_real.socket_io_attachments_id_seq TO restaurante_tiempo_real;
`;

const SQL_DOWN = `
DROP TABLE tiempo_real.socket_io_attachments;
DROP SCHEMA tiempo_real;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
