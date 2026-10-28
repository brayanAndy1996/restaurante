// Historia 003 · carta, grupo C3 (criterios 24 a 29, 63 a 65): grupos de modificadores.
//
// - `grupo_modificadores`: conjunto de opciones que se ofrece en un producto ("Término de la carne", "Extras");
//   reutilizable en varios productos. `seleccion` es `UNICA` o `MULTIPLE`; `minimo` y `maximo` dicen cuántas
//   opciones se eligen (`UNICA`: máximo 1, y mínimo 1 si es obligatorio). Único por `lower(nombre)`.
// - `modificador`: una opción del grupo, con su precio extra (0 o más) y, si descuenta o prepara otro
//   producto, ese producto ligado. Nunca se borra: pasa a inactivo (las ventas y el menú del día lo
//   referencian). Único por `lower(nombre)` dentro del grupo solo entre los activos.
// - `producto_grupo`: qué grupos tiene cada producto y en qué orden. Es la única de las tres que borra filas
//   (la lista de grupos de un producto se reemplaza completa).
// - Los `CHECK` aceptan `NULL` y los valores por defecto a propósito: la prueba de catálogo de trazabilidad
//   (002, criterio 113) inserta filas casi vacías en una copia de la tabla y solo debe rechazar por la
//   trazabilidad. Con `NULL`, `minimo`, `maximo` y `seleccion` hacen que el `CHECK` del grupo se evalúe a
//   desconocido, que PostgreSQL acepta; la API siempre los envía.
// - Las reglas entre tablas (producto ligado `SIMPLE` y activo, grupo activo al asignarlo) las valida el
//   servicio; la base garantiza la empresa con las llaves foráneas compuestas con `empresa_id`.
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE; `producto_grupo`, además DELETE. Ninguna migración escribe datos.
//
// `down` borra las tres tablas con sus datos (el código de C3 ya no existiría), en orden inverso.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE grupo_modificadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  seleccion text NOT NULL CHECK (seleccion IN ('UNICA', 'MULTIPLE')),
  minimo smallint NOT NULL,
  maximo smallint NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grupo_modificadores_regla_ck CHECK (
    minimo >= 0 AND maximo BETWEEN 1 AND 50 AND minimo <= maximo
    AND (seleccion = 'MULTIPLE' OR maximo = 1)
  ),
  CONSTRAINT grupo_modificadores_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE UNIQUE INDEX grupo_modificadores_nombre_unico ON grupo_modificadores (empresa_id, lower(nombre));
CREATE INDEX grupo_modificadores_empresa_id_idx ON grupo_modificadores (empresa_id);
${sqlTablaDeEmpresaTrazable('grupo_modificadores', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE modificador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  grupo_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  -- Monto que suma al precio de la línea, en soles; 0 o más.
  precio_extra numeric(10, 2) NOT NULL DEFAULT 0 CHECK (precio_extra >= 0),
  -- Producto ligado (simple): va a su estación y descuenta su stock al elegir el modificador.
  producto_id uuid,
  orden integer NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modificador_grupo_fk
    FOREIGN KEY (grupo_id, empresa_id) REFERENCES grupo_modificadores (id, empresa_id),
  CONSTRAINT modificador_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT modificador_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE UNIQUE INDEX modificador_nombre_unico ON modificador (grupo_id, lower(nombre)) WHERE activo;
CREATE INDEX modificador_empresa_id_idx ON modificador (empresa_id);
CREATE INDEX modificador_grupo_orden_idx ON modificador (grupo_id, orden);
CREATE INDEX modificador_producto_idx ON modificador (producto_id) WHERE producto_id IS NOT NULL;
${sqlTablaDeEmpresaTrazable('modificador', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE producto_grupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  producto_id uuid NOT NULL,
  grupo_id uuid NOT NULL,
  orden integer NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_grupo_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT producto_grupo_grupo_fk
    FOREIGN KEY (grupo_id, empresa_id) REFERENCES grupo_modificadores (id, empresa_id),
  CONSTRAINT producto_grupo_unico UNIQUE (producto_id, grupo_id),
  CONSTRAINT producto_grupo_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX producto_grupo_empresa_id_idx ON producto_grupo (empresa_id);
CREATE INDEX producto_grupo_grupo_idx ON producto_grupo (grupo_id);
${sqlTablaDeEmpresaTrazable('producto_grupo', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE producto_grupo;
DROP TABLE modificador;
DROP TABLE grupo_modificadores;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
