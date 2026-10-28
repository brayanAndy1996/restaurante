// Historia 003 · carta, grupo C2 (criterios 18 a 23 y 19b, 63 a 65): ajuste de un producto por sucursal.
//
// - `producto_sucursal`: guarda solo lo que difiere del valor por defecto de la empresa. `precio` es el de la
//   sucursal (nulo = usa el de la empresa) y `disponible` dice si se ofrece ahí (por defecto sí). Sin fila, el
//   producto vale el precio de la empresa y está disponible (criterio 23). Único por `(producto_id, sucursal_id)`.
// - Los `CHECK` aceptan `NULL` y los valores por defecto (la prueba de catálogo de trazabilidad inserta filas casi
//   vacías): `precio > 0` se cumple con `NULL`, y `disponible` tiene valor por defecto.
// - La base garantiza la empresa con las llaves foráneas compuestas hacia `producto` y `sucursal`. Que un producto
//   que no se vende solo no lleve precio de sucursal (criterio 19), y quién puede ajustar cada sucursal
//   (criterio 19b), lo valida el servicio.
// - Tabla de empresa trazable (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE (la fila no se borra: queda con su último autor). Ninguna
//   migración escribe datos.
//
// `down` borra la tabla con sus datos (el código de C2 ya no existiría).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE producto_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  producto_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  -- Precio de la sucursal con IGV, en soles; nulo = el de la empresa.
  precio numeric(10, 2) CHECK (precio > 0),
  disponible boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_sucursal_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT producto_sucursal_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT producto_sucursal_unico UNIQUE (producto_id, sucursal_id),
  CONSTRAINT producto_sucursal_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX producto_sucursal_empresa_id_idx ON producto_sucursal (empresa_id);
CREATE INDEX producto_sucursal_sucursal_idx ON producto_sucursal (sucursal_id);
${sqlTablaDeEmpresaTrazable('producto_sucursal', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE producto_sucursal;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
