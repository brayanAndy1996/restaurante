// Historia 003 · carta, grupo C1 (criterios 1 a 17, 63 a 65): estaciones de producción, familias y productos.
//
// - `estacion`: lugar que prepara un producto (Cocina, Barra); por empresa, único por `lower(nombre)`.
// - `familia`: grupo de la carta con su orden manual; único por `lower(nombre)`.
// - `producto`: lo que se vende o se prepara (`SIMPLE`, `COMBO` o `MENU_DEL_DIA`). `precio` es el de la
//   empresa, con IGV. `CHECK`: `se_vende_solo = (precio IS NOT NULL)` (un producto que no se vende solo no
//   lleva precio) y `tipo = 'SIMPLE' OR (se_vende_solo AND estacion_id IS NULL)` (un combo o un menú se vende
//   solo y no tiene estación propia). `foto_clave` es la clave del archivo en el almacén (nunca la URL).
// - Las reglas entre tablas (estación o familia activas, un producto usado como componente) las valida el
//   servicio; la base garantiza la empresa con las llaves foráneas compuestas con `empresa_id`.
// - Las tres son tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios
//   de `restaurante_api`: SELECT, INSERT y UPDATE (nada se borra; se desactiva). Ninguna migración escribe datos.
//
// `down` borra las tres tablas con sus datos (el código de C1 ya no existiría), en orden inverso.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE estacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 50),
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estacion_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE UNIQUE INDEX estacion_nombre_unico ON estacion (empresa_id, lower(nombre));
CREATE INDEX estacion_empresa_id_idx ON estacion (empresa_id);
${sqlTablaDeEmpresaTrazable('estacion', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE familia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  orden integer NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT familia_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE UNIQUE INDEX familia_nombre_unico ON familia (empresa_id, lower(nombre));
CREATE INDEX familia_empresa_id_idx ON familia (empresa_id);
${sqlTablaDeEmpresaTrazable('familia', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE producto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  familia_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('SIMPLE', 'COMBO', 'MENU_DEL_DIA')),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  descripcion text CHECK (descripcion IS NULL OR char_length(descripcion) BETWEEN 1 AND 500),
  -- Precio de la empresa con IGV, en soles; nulo si el producto no se vende solo.
  precio numeric(10, 2) CHECK (precio > 0),
  se_vende_solo boolean NOT NULL DEFAULT true,
  afectacion_igv text NOT NULL DEFAULT 'GRAVADO'
    CHECK (afectacion_igv IN ('GRAVADO', 'EXONERADO', 'INAFECTO')),
  aplica_icbper boolean NOT NULL DEFAULT false,
  estacion_id uuid,
  tipo_control_stock text NOT NULL
    CHECK (tipo_control_stock IN ('UNIDADES', 'PORCIONES', 'SIN_CONTROL')),
  -- Clave del archivo en el almacén (carta/<empresa>/<producto>/<uuid>.<ext>); la URL se arma al leer.
  foto_clave text CHECK (foto_clave IS NULL OR char_length(foto_clave) BETWEEN 1 AND 300),
  orden integer NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producto_familia_fk
    FOREIGN KEY (familia_id, empresa_id) REFERENCES familia (id, empresa_id),
  CONSTRAINT producto_estacion_fk
    FOREIGN KEY (estacion_id, empresa_id) REFERENCES estacion (id, empresa_id),
  CONSTRAINT producto_se_vende_solo_ck CHECK (se_vende_solo = (precio IS NOT NULL)),
  CONSTRAINT producto_tipo_ck CHECK (tipo = 'SIMPLE' OR (se_vende_solo AND estacion_id IS NULL)),
  CONSTRAINT producto_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE UNIQUE INDEX producto_nombre_unico ON producto (empresa_id, lower(nombre));
CREATE INDEX producto_empresa_id_idx ON producto (empresa_id);
CREATE INDEX producto_familia_orden_idx ON producto (empresa_id, familia_id, orden);
CREATE INDEX producto_estacion_idx ON producto (estacion_id) WHERE estacion_id IS NOT NULL;
${sqlTablaDeEmpresaTrazable('producto', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE producto;
DROP TABLE familia;
DROP TABLE estacion;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
