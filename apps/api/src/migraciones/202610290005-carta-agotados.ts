// Historia 003 · carta, grupo C5 (criterios 39 a 44, 53 y 63 a 65): agotados (86) por sucursal.
//
// - `producto_agotado`: un producto agotado en una sucursal. `desde` es el instante en que se marcó,
//   `dia_operativo` el día de negocio de la sucursal en ese instante (la API lo calcula con su reloj y la hora
//   de corte, nunca con `now()` de la base), `hasta` dice cuánto dura (`FIN_DEL_DIA` o `REACTIVAR`, decisión 4)
//   y `origen` quién lo marcó (`MANUAL`, o `SIN_STOCK` que pondrá la sección 6). Único por
//   `(producto_id, sucursal_id)`: marcar de nuevo actualiza la fila.
// - La vigencia no se guarda: se calcula al leer con `agotadoVigente` de `packages/dominio` (no hay tareas
//   programadas). Un agotado vencido puede quedar como fila sin efecto hasta el siguiente marcado; reactivar
//   borra la fila (queda en la auditoría), por eso `restaurante_api` también tiene DELETE.
// - Los `CHECK` aceptan `NULL` y los valores por defecto a propósito: la prueba de catálogo de trazabilidad
//   (002, criterio 113) inserta filas casi vacías en una copia de la tabla y solo debe rechazar por la
//   trazabilidad. La API siempre envía `hasta`, `dia_operativo` y `origen`.
// - La base garantiza la empresa con las llaves foráneas compuestas con `empresa_id` hacia `producto` y
//   `sucursal`. Que el producto exista en la empresa y que la sucursal sea la activa de la sesión lo valida el
//   servicio.
// - Tabla de empresa trazable (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT, UPDATE y DELETE. Ninguna migración escribe datos.
//
// `down` borra la tabla con sus datos (el código de C5 ya no existiría).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE producto_agotado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  producto_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  -- Instante en que se marcó.
  desde timestamptz NOT NULL DEFAULT now(),
  -- Día operativo de la sucursal en ese instante (fecha de negocio según su hora de corte).
  dia_operativo date NOT NULL,
  hasta text NOT NULL DEFAULT 'FIN_DEL_DIA' CHECK (hasta IN ('FIN_DEL_DIA', 'REACTIVAR')),
  origen text NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL', 'SIN_STOCK')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_agotado_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT producto_agotado_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT producto_agotado_unico UNIQUE (producto_id, sucursal_id),
  CONSTRAINT producto_agotado_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX producto_agotado_empresa_id_idx ON producto_agotado (empresa_id);
CREATE INDEX producto_agotado_sucursal_idx ON producto_agotado (sucursal_id);
${sqlTablaDeEmpresaTrazable('producto_agotado', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE producto_agotado;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
