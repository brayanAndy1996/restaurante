// Historia 004 · salón y cocina, entrega 3b, grupo C7 (criterios 99 a 105): impresoras, destino de cada estación e
// impresora de caja (RF-76, RF-19 segunda parte).
//
// - `impresora`: una impresora de la sucursal. `conexion_tipo` es `RED` (con `host` y `puerto`) o `BLUETOOTH` (con
//   `mac`); un `CHECK` obliga a que lleve los campos de su tipo y ninguno del otro. En 3b solo la de red imprime:
//   Bluetooth y `gaveta` se guardan (decisión 12). Nada se borra: se desactiva (`activa`). El nombre no se repite
//   en la sucursal sin distinguir mayúsculas (criterio 103).
// - `estacion_destino`: adónde sale la comanda de una estación en una sucursal. Sin fila, `KDS` (criterio 99).
//   `IMPRESORA` exige `impresora_id` y `KDS` no puede llevarlo. La estación es de la empresa y la impresora, de la
//   misma sucursal.
// - `impresion_sucursal`: la configuración de impresión de la sucursal (una fila por sucursal): la impresora de
//   caja, la de la pre-cuenta (criterio 102), de la misma sucursal.
// - Todos los únicos empiezan por `empresa_id`, y las llaves foráneas son compuestas con `empresa_id`: un id de
//   otra empresa se rechaza igual que uno inexistente y ningún índice delata filas ajenas (criterios 84 y 131).
//   `impresora` publica la llave `(id, sucursal_id, empresa_id)` para que un destino o la impresora de caja no
//   puedan apuntar a una impresora de otra sucursal.
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE; nada se borra. Ninguna migración escribe datos.
//
// Las tablas del puente y de los trabajos (`vinculacion_puente`, `puente`, `trabajo_impresion`) son de la migración
// `202610310002-puente` (T40). `down` borra las tres tablas con sus datos.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE impresora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 40),
  conexion_tipo text NOT NULL CHECK (conexion_tipo IN ('RED', 'BLUETOOTH')),
  host text CHECK (host IS NULL OR char_length(host) BETWEEN 1 AND 253),
  puerto integer CHECK (puerto IS NULL OR puerto BETWEEN 1 AND 65535),
  mac text CHECK (mac IS NULL OR mac ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'),
  ancho_mm smallint NOT NULL CHECK (ancho_mm IN (58, 80)),
  juego_caracteres text NOT NULL
    CHECK (juego_caracteres IN ('PC850', 'PC858', 'WPC1252', 'PC437', 'SIN_TILDES')),
  gaveta boolean NOT NULL DEFAULT false,
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impresora_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- Una impresora de red lleva host y puerto; una Bluetooth, la dirección y nada de red. Cada CHECK deja pasar
  -- el valor nulo del tipo (la prueba de catálogo de trazabilidad inserta filas casi vacías en una copia).
  CONSTRAINT impresora_red_ck
    CHECK (conexion_tipo <> 'RED' OR (host IS NOT NULL AND puerto IS NOT NULL AND mac IS NULL)),
  CONSTRAINT impresora_bluetooth_ck
    CHECK (conexion_tipo <> 'BLUETOOTH' OR (mac IS NOT NULL AND host IS NULL AND puerto IS NULL)),
  CONSTRAINT impresora_id_empresa_unico UNIQUE (id, empresa_id),
  -- Llave de los destinos y de la impresora de caja: la impresora es de la misma sucursal y empresa.
  CONSTRAINT impresora_id_sucursal_empresa_unico UNIQUE (id, sucursal_id, empresa_id)
);
CREATE INDEX impresora_empresa_id_idx ON impresora (empresa_id);
CREATE INDEX impresora_sucursal_idx ON impresora (sucursal_id);
-- El nombre no se repite entre las impresoras de la sucursal, sin distinguir mayúsculas (criterio 103).
CREATE UNIQUE INDEX impresora_nombre_unico ON impresora (empresa_id, sucursal_id, lower(nombre));
${sqlTablaDeEmpresaTrazable('impresora', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE estacion_destino (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  estacion_id uuid NOT NULL,
  destino text NOT NULL CHECK (destino IN ('KDS', 'IMPRESORA')),
  impresora_id uuid,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estacion_destino_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT estacion_destino_estacion_fk
    FOREIGN KEY (estacion_id, empresa_id) REFERENCES estacion (id, empresa_id),
  CONSTRAINT estacion_destino_impresora_fk
    FOREIGN KEY (impresora_id, sucursal_id, empresa_id)
    REFERENCES impresora (id, sucursal_id, empresa_id),
  -- IMPRESORA lleva su impresora; KDS no (criterio 100).
  CONSTRAINT estacion_destino_impresora_ck CHECK ((destino = 'IMPRESORA') = (impresora_id IS NOT NULL)),
  CONSTRAINT estacion_destino_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX estacion_destino_empresa_id_idx ON estacion_destino (empresa_id);
-- Una estación tiene un solo destino por sucursal; sin fila, KDS (criterio 99).
CREATE UNIQUE INDEX estacion_destino_unico ON estacion_destino (empresa_id, sucursal_id, estacion_id);
-- Saber si una impresora es destino de alguna estación (criterio 104).
CREATE INDEX estacion_destino_impresora_idx ON estacion_destino (empresa_id, impresora_id)
  WHERE impresora_id IS NOT NULL;
${sqlTablaDeEmpresaTrazable('estacion_destino', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE impresion_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  impresora_caja_id uuid,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT impresion_sucursal_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT impresion_sucursal_caja_fk
    FOREIGN KEY (impresora_caja_id, sucursal_id, empresa_id)
    REFERENCES impresora (id, sucursal_id, empresa_id),
  CONSTRAINT impresion_sucursal_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX impresion_sucursal_empresa_id_idx ON impresion_sucursal (empresa_id);
-- Una fila de configuración de impresión por sucursal.
CREATE UNIQUE INDEX impresion_sucursal_unico ON impresion_sucursal (empresa_id, sucursal_id);
CREATE INDEX impresion_sucursal_caja_idx ON impresion_sucursal (empresa_id, impresora_caja_id)
  WHERE impresora_caja_id IS NOT NULL;
${sqlTablaDeEmpresaTrazable('impresion_sucursal', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE impresion_sucursal;
DROP TABLE estacion_destino;
DROP TABLE impresora;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
