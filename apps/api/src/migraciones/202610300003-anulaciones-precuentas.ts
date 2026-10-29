// Historia 004 · salón y cocina, grupo C5 (criterios 35 a 44, 50 a 54 y 82 a 86): las dos tablas de pedidos que
// faltaban de la entrega 3a.
//
// - `anulacion_item`: lo que se anuló de un ítem enviado (cantidad, motivo, destino del stock, quién autorizó con
//   su clave y con qué autorización). Anular una orden guarda una fila por cada ítem vigente, marcadas
//   `de_orden`. `huella_entrada` es el SHA-256 de lo pedido (ítem, cantidad, destino y motivo) y sirve para
//   reconocer la réplica por el id del cliente. Solo se inserta: una anulación no se corrige ni se borra (la API
//   tiene SELECT e INSERT, sin UPDATE).
// - `precuenta`: el detalle de la cuenta que se mostró al cliente. `lineas` y `total` quedan como se emitieron;
//   `version_orden` es la versión de la orden en ese momento (la pre-cuenta vigente es igual si coincide con
//   `orden.version`) e `invalidada_en` se pone cuando la orden cambia. Una orden tiene a lo sumo una vigente.
// - Las dos tienen clave primaria `(empresa_id, id)`: el id lo genera la PWA, y el mismo UUID usado en otra
//   empresa crea su propia fila sin chocar ni revelar que existe (criterio 85). Todos los índices únicos llevan
//   `empresa_id` por la misma razón. Las llaves foráneas son compuestas con la empresa.
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api` (spec, "Permisos"): `anulacion_item` SELECT e INSERT; `precuenta` SELECT, INSERT y UPDATE
//   (se invalida). Nada se borra. Ninguna migración escribe datos.
//
// `down` borra las dos tablas con sus datos.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE anulacion_item (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  item_id uuid NOT NULL,
  -- La orden donde se anuló (la vigente del ítem en ese momento).
  orden_id uuid NOT NULL,
  cantidad smallint NOT NULL CHECK (cantidad BETWEEN 1 AND 999),
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 300),
  -- Para la sección 6 (stock): si lo anulado vuelve al inventario o es merma.
  destino_stock text NOT NULL CHECK (destino_stock IN ('VUELVE', 'MERMA')),
  -- El supervisor que dio la clave y su autorización, si quien anuló la necesitaba.
  autorizado_por_id uuid,
  autorizacion_id uuid,
  -- La fila es parte de la anulación de una orden entera.
  de_orden boolean NOT NULL DEFAULT false,
  -- SHA-256 de lo pedido, para reconocer la réplica por el id (criterio 37).
  huella_entrada bytea NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anulacion_item_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT anulacion_item_item_fk FOREIGN KEY (item_id, empresa_id) REFERENCES item (id, empresa_id),
  CONSTRAINT anulacion_item_orden_fk
    FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT anulacion_item_autorizado_por_fk
    FOREIGN KEY (autorizado_por_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT anulacion_item_autorizacion_fk
    FOREIGN KEY (autorizacion_id, empresa_id) REFERENCES autorizacion (id, empresa_id),
  CONSTRAINT anulacion_item_autorizacion_ck
    CHECK ((autorizado_por_id IS NULL) = (autorizacion_id IS NULL))
);
CREATE INDEX anulacion_item_empresa_id_idx ON anulacion_item (empresa_id);
CREATE INDEX anulacion_item_item_idx ON anulacion_item (item_id);
CREATE INDEX anulacion_item_orden_idx ON anulacion_item (orden_id);
${sqlTablaDeEmpresaTrazable('anulacion_item', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE precuenta (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL,
  numero smallint NOT NULL CHECK (numero >= 1),
  -- Las líneas y el total tal como se emitieron (suma de totales vigentes, con IGV incluido, sin desglose).
  lineas jsonb NOT NULL,
  total numeric(10, 2) NOT NULL CHECK (total >= 0),
  emitida_en timestamptz NOT NULL,
  invalidada_en timestamptz,
  -- La versión de la orden al emitirla: la pre-cuenta vigente es igual si coincide con orden.version.
  version_orden integer NOT NULL CHECK (version_orden >= 1),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT precuenta_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT precuenta_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id)
);
CREATE INDEX precuenta_empresa_id_idx ON precuenta (empresa_id);
CREATE INDEX precuenta_orden_idx ON precuenta (orden_id);
CREATE UNIQUE INDEX precuenta_numero_unico ON precuenta (empresa_id, orden_id, numero);
-- A lo sumo una pre-cuenta vigente por orden.
CREATE UNIQUE INDEX precuenta_vigente_unica ON precuenta (empresa_id, orden_id)
  WHERE invalidada_en IS NULL;
${sqlTablaDeEmpresaTrazable('precuenta', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE precuenta;
DROP TABLE anulacion_item;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
