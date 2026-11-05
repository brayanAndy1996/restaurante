// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C1 (criterio 6, plan "Migraciones" 1): la tasa de IGV
// de cada emisor por vigencia.
//
// - `emisor_tasa_igv`: una fila por emisor y fecha de inicio (`desde`, fecha de Lima). El cobro usa la tasa con el
//   mayor `desde` menor o igual a la fecha de emisión (`tasaIgvVigente`, `packages/dominio`); sin ninguna, el cobro
//   responde 409 `TASA_IGV_NO_CONFIGURADA`. Un emisor `NUEVO_RUS` no usa tasa.
// - Tabla de empresa trazable (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Dueño: plataforma. Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE (se cambia la tasa de una vigencia); nada se borra. `restaurante_plataforma`
//   no recibe privilegios. Ninguna migración escribe datos.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE emisor_tasa_igv (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  emisor_id uuid NOT NULL,
  -- Fecha de Lima desde la que rige la tasa.
  desde date NOT NULL,
  -- Porcentaje con 2 decimales: de 0.01 a 30.00.
  tasa numeric(5, 2) NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emisor_tasa_igv_emisor_fk FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT emisor_tasa_igv_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT emisor_tasa_igv_tasa_ck CHECK (tasa BETWEEN 0.01 AND 30.00)
);
CREATE INDEX emisor_tasa_igv_empresa_id_idx ON emisor_tasa_igv (empresa_id);
CREATE UNIQUE INDEX emisor_tasa_igv_desde_unico ON emisor_tasa_igv (empresa_id, emisor_id, desde);
${sqlTablaDeEmpresaTrazable('emisor_tasa_igv', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE emisor_tasa_igv;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
