// Historia 004 · salón y cocina, grupo C1 (criterios 1 a 6): el mapa de mesas (RF-22).
//
// - `zona`: un área del salón de una sucursal con su cuadrícula (`columnas` × `filas`); `orden` es la posición
//   entre las zonas de la sucursal. Nada se borra: se desactiva (`activa`).
// - `mesa`: una mesa dibujada en una celda de la cuadrícula de su zona. `columna` y `fila` cuentan desde 1. No
//   tiene columna de estado: libre, ocupada o en pre-cuenta se calcula de la orden vigente (criterio 8).
// - Los únicos de nombre y de celda llevan `empresa_id` primero y valen solo para las zonas y mesas activas
//   (la zona, para todas): así un nombre o una celda iguales en otra empresa nunca chocan ni revelan que existen
//   (criterio 85). La unicidad de la celda por zona la mantiene además el servicio, que traduce el rechazo a
//   409 `CONFLICTO` con `campos`.
// - La mesa guarda `sucursal_id` y la llave foránea compuesta `(zona_id, sucursal_id, empresa_id)` obliga a que
//   su zona sea de la misma sucursal y de la misma empresa; la zona, a su vez, apunta a `sucursal` con
//   `empresa_id`. Que la celda caiga dentro de la cuadrícula lo valida el servicio (es una regla entre dos
//   tablas).
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE; nada se borra. Ninguna migración escribe datos.
//
// `down` borra las dos tablas con sus datos (el código de C1 ya no existiría); la migración de pedidos de C2 las
// referencia y se revierte antes.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE zona (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 40),
  orden integer NOT NULL,
  columnas smallint NOT NULL CHECK (columnas BETWEEN 2 AND 12),
  filas smallint NOT NULL CHECK (filas BETWEEN 1 AND 30),
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zona_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT zona_id_empresa_unico UNIQUE (id, empresa_id),
  -- Llave de la mesa: su zona es de la misma sucursal y de la misma empresa.
  CONSTRAINT zona_id_sucursal_empresa_unico UNIQUE (id, sucursal_id, empresa_id)
);
CREATE INDEX zona_empresa_id_idx ON zona (empresa_id);
CREATE INDEX zona_sucursal_idx ON zona (sucursal_id, orden);
-- El nombre no se repite entre las zonas de la sucursal, sin distinguir mayúsculas (criterio 1).
CREATE UNIQUE INDEX zona_nombre_unico ON zona (empresa_id, sucursal_id, lower(nombre));
${sqlTablaDeEmpresaTrazable('zona', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE mesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  zona_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 20),
  capacidad smallint NOT NULL CHECK (capacidad BETWEEN 1 AND 50),
  forma text NOT NULL CHECK (forma IN ('CUADRADA', 'REDONDA', 'RECTANGULAR')),
  -- La primera celda es la columna 1, fila 1.
  columna smallint NOT NULL CHECK (columna >= 1),
  fila smallint NOT NULL CHECK (fila >= 1),
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT mesa_zona_fk
    FOREIGN KEY (zona_id, sucursal_id, empresa_id) REFERENCES zona (id, sucursal_id, empresa_id),
  CONSTRAINT mesa_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX mesa_empresa_id_idx ON mesa (empresa_id);
CREATE INDEX mesa_zona_idx ON mesa (zona_id);
-- Entre las mesas activas de la sucursal el nombre no se repite, sin distinguir mayúsculas (criterio 3).
CREATE UNIQUE INDEX mesa_nombre_activa_unico ON mesa (empresa_id, sucursal_id, lower(nombre))
  WHERE activa;
-- Una celda de la zona tiene como máximo una mesa activa (criterio 3).
CREATE UNIQUE INDEX mesa_celda_activa_unica ON mesa (empresa_id, zona_id, columna, fila)
  WHERE activa;
${sqlTablaDeEmpresaTrazable('mesa', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE mesa;
DROP TABLE zona;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
