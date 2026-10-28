// Historia 003 · carta, grupo C4 (criterios 6 a 12, 30 a 38 y 63 a 65): combos y menú del día.
//
// - `componente_combo`: los productos fijos de un combo o de un menú del día, con su cantidad (1 a 99). `combo_id`
//   y `producto_id` apuntan a `producto`; que el componente sea `SIMPLE` y que el combo no se contenga a sí mismo
//   lo exige además el `CHECK combo_id <> producto_id`. Único por `(combo_id, producto_id)`. La lista de
//   componentes de un combo se reemplaza completa, así que la tabla también borra filas.
// - `menu_del_dia_opcion`: qué platos candidatos (modificadores del menú) se ofrecen un día operativo en una
//   sucursal. Una fila por sucursal, menú, día y modificador. El día es la fecha de negocio de la sucursal según
//   su hora de corte (la API la calcula con su reloj, nunca con `now()` de la base). Las opciones de un día se
//   reemplazan completas y se borran al dejar de ser menú el producto.
// - Los `CHECK` aceptan `NULL` y los valores por defecto a propósito: la prueba de catálogo de trazabilidad
//   (002, criterio 113) inserta filas casi vacías en una copia de la tabla y solo debe rechazar por la
//   trazabilidad. `CHECK (cantidad BETWEEN 1 AND 99)` y `CHECK (combo_id <> producto_id)` se evalúan a
//   desconocido con `NULL`, que PostgreSQL acepta; la API siempre envía esos campos.
// - Las reglas entre tablas (componente `SIMPLE` y activo, opción del día de un grupo activo asignado al menú,
//   un `SIMPLE` sin componentes, un no-menú sin opciones del día) las valida el servicio dentro de la
//   transacción; la base garantiza la empresa con las llaves foráneas compuestas con `empresa_id`.
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT, UPDATE y DELETE en las dos. Ninguna migración escribe datos.
//
// `down` borra las dos tablas con sus datos (el código de C4 ya no existiría), en orden inverso.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE componente_combo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  combo_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  cantidad smallint NOT NULL CHECK (cantidad BETWEEN 1 AND 99),
  orden integer NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT componente_combo_combo_fk
    FOREIGN KEY (combo_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT componente_combo_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT componente_combo_distintos_ck CHECK (combo_id <> producto_id),
  CONSTRAINT componente_combo_unico UNIQUE (combo_id, producto_id),
  CONSTRAINT componente_combo_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX componente_combo_empresa_id_idx ON componente_combo (empresa_id);
CREATE INDEX componente_combo_producto_idx ON componente_combo (producto_id);
${sqlTablaDeEmpresaTrazable('componente_combo', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE menu_del_dia_opcion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  -- El menú del día (producto de tipo MENU_DEL_DIA).
  producto_id uuid NOT NULL,
  modificador_id uuid NOT NULL,
  -- Día operativo de la sucursal (fecha de negocio según su hora de corte).
  dia_operativo date NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_del_dia_opcion_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT menu_del_dia_opcion_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT menu_del_dia_opcion_modificador_fk
    FOREIGN KEY (modificador_id, empresa_id) REFERENCES modificador (id, empresa_id),
  CONSTRAINT menu_del_dia_opcion_unico
    UNIQUE (sucursal_id, producto_id, dia_operativo, modificador_id),
  CONSTRAINT menu_del_dia_opcion_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX menu_del_dia_opcion_empresa_id_idx ON menu_del_dia_opcion (empresa_id);
CREATE INDEX menu_del_dia_opcion_sucursal_dia_idx ON menu_del_dia_opcion (sucursal_id, dia_operativo);
CREATE INDEX menu_del_dia_opcion_producto_idx ON menu_del_dia_opcion (producto_id);
CREATE INDEX menu_del_dia_opcion_modificador_idx ON menu_del_dia_opcion (modificador_id);
${sqlTablaDeEmpresaTrazable('menu_del_dia_opcion', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE menu_del_dia_opcion;
DROP TABLE componente_combo;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
