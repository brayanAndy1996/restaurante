// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C1 (criterios 3 a 5, 69 a 78 y 102 a 105, plan
// "Migraciones" 3): las series y los comprobantes. Dueño: facturación.
//
// - `serie`: una fila por serie de una caja y un emisor, con su último número. Se numera con
//   `UPDATE serie SET ultimo_numero = ultimo_numero + 1 … RETURNING` en la transacción del cobro: una reversión deshace el
//   incremento y no deja huecos (criterio 71); las secuencias de PostgreSQL no sirven porque no se revierten. Es única por
//   emisor y tipo en todas las cajas y sucursales (criterio 4) y solo una está activa por caja y tipo. `primer_numero`
//   guarda con qué número se creó (criterio 5). El `23514` de `serie_ultimo_numero_ck` al numerar es `SERIE_AGOTADA`.
// - `comprobante`: la boleta o factura tal como era al emitirse (criterio 69): emisor, sucursal y cliente copiados, los
//   totales del criterio 11, la orden con sus mesas y su mozo, el turno con su responsable y el detalle calculado de la
//   parte (`detalle_parte`, de donde `FacturadoService` saca lo ya cobrado). `cobro_id` (obligatorio en 6a) no tiene llave
//   foránea: el cobro se inserta después y su integridad la da `cobro.comprobante_id`. Los `CHECK` repiten las cuentas
//   de montos, así una fila que no cuadra no entra.
// - `comprobante_linea`: una fila por línea con su desglose y, en las cortesías, el valor referencial.
// - Todas son tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api` (spec, "Permisos" y criterio 78): `serie` SELECT, INSERT y UPDATE; `comprobante` SELECT e INSERT y
//   UPDATE solo de `estado` y las columnas `actualizado_*` (nunca de montos ni de `detalle_parte`); `comprobante_linea`
//   SELECT e INSERT. Nadie borra. Ninguna migración escribe datos.
// - También agrega la llave foránea de `movimiento_caja.comprobante_id` (migración `202611040002-caja`) hacia `comprobante`.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE serie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  caja_id uuid NOT NULL,
  -- El emisor de la sucursal de la caja cuando se creó la serie; si la sucursal cambia de emisor, ya no emite.
  emisor_id uuid NOT NULL,
  -- 6b agrega las notas de crédito.
  tipo text NOT NULL CHECK (tipo IN ('BOLETA', 'FACTURA')),
  serie text NOT NULL,
  primer_numero integer NOT NULL DEFAULT 1,
  ultimo_numero integer NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serie_caja_fk FOREIGN KEY (caja_id, empresa_id) REFERENCES caja (id, empresa_id),
  CONSTRAINT serie_emisor_fk FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT serie_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT serie_forma_ck CHECK (
    (tipo = 'BOLETA' AND serie ~ '^B[A-Z0-9]{3}$') OR (tipo = 'FACTURA' AND serie ~ '^F[A-Z0-9]{3}$')
  ),
  CONSTRAINT serie_primer_numero_ck CHECK (primer_numero BETWEEN 1 AND 99999999),
  CONSTRAINT serie_ultimo_numero_ck CHECK (ultimo_numero BETWEEN primer_numero - 1 AND 99999999)
);
CREATE INDEX serie_empresa_id_idx ON serie (empresa_id);
-- Una serie no se repite para un emisor en ninguna caja ni sucursal, activa o inactiva (criterio 4).
CREATE UNIQUE INDEX serie_emisor_tipo_serie_unica ON serie (empresa_id, emisor_id, tipo, serie);
-- Una serie activa por caja y tipo.
CREATE UNIQUE INDEX serie_activa_por_caja_y_tipo ON serie (empresa_id, caja_id, tipo) WHERE activa;
${sqlTablaDeEmpresaTrazable('serie', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE comprobante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  emisor_id uuid NOT NULL,
  caja_id uuid NOT NULL,
  turno_id uuid NOT NULL,
  -- El responsable del turno al emitir: el alcance del Cajero (criterio 100) sin leer 'turno'.
  turno_responsable_id uuid NOT NULL,
  -- Sin llave foránea: el cobro se inserta después, y 'cobro.comprobante_id' da la integridad. Obligatorio en 6a (todo
  -- comprobante viene de un cobro); 6b lo vuelve opcional para las notas de crédito. Es NOT NULL y no un CHECK: el
  -- catálogo de trazabilidad de 002 (criterio 113) prueba los CHECK de cada tabla con filas casi vacías.
  cobro_id uuid NOT NULL,
  serie_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('BOLETA', 'FACTURA')),
  serie text NOT NULL CHECK (char_length(serie) = 4),
  numero integer NOT NULL CHECK (numero BETWEEN 1 AND 99999999),
  formato text NOT NULL CHECK (formato IN ('DETALLADO', 'CONSUMO')),
  -- Fecha de Lima del instante del cobro (SUNAT); define la tasa y el ICBPER vigentes.
  fecha_emision date NOT NULL,
  emitido_en timestamptz NOT NULL,
  -- Día operativo de la sucursal (hora de corte, B.9), para los reportes.
  dia_operativo date NOT NULL,
  emisor jsonb NOT NULL,
  sucursal jsonb NOT NULL,
  cliente_tipo_documento text CHECK (cliente_tipo_documento IN ('DNI', 'CE', 'PASAPORTE', 'RUC')),
  cliente_numero text CHECK (char_length(cliente_numero) BETWEEN 1 AND 20),
  cliente_nombre text CHECK (char_length(cliente_nombre) BETWEEN 1 AND 200),
  cliente_direccion text CHECK (char_length(cliente_direccion) BETWEEN 1 AND 300),
  moneda char(3) NOT NULL DEFAULT 'PEN' CHECK (moneda = 'PEN'),
  -- Nula con un emisor Nuevo RUS: entonces las cuatro 'op_*' también son nulas.
  tasa_igv numeric(5, 2) CHECK (tasa_igv IS NULL OR tasa_igv BETWEEN 0.01 AND 30.00),
  subtotal numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  descuentos numeric(10, 2) NOT NULL CHECK (descuentos >= 0),
  op_gravadas numeric(10, 2) CHECK (op_gravadas >= 0),
  op_exoneradas numeric(10, 2) CHECK (op_exoneradas >= 0),
  op_inafectas numeric(10, 2) CHECK (op_inafectas >= 0),
  op_gratuitas numeric(10, 2) CHECK (op_gratuitas >= 0),
  igv numeric(10, 2) NOT NULL CHECK (igv >= 0),
  igv_gratuitas numeric(10, 2) NOT NULL CHECK (igv_gratuitas >= 0),
  icbper numeric(10, 2) NOT NULL CHECK (icbper >= 0),
  total numeric(10, 2) NOT NULL CHECK (total >= 0),
  monto_en_letras text NOT NULL CHECK (char_length(monto_en_letras) BETWEEN 1 AND 200),
  orden_id uuid,
  -- Los nombres de las mesas vigentes de la orden al cobrar; vacío en el mostrador.
  mesas text[],
  mozo_nombre text CHECK (char_length(mozo_nombre) BETWEEN 1 AND 100),
  numero_llamado integer,
  -- Su lugar entre las partes de la orden (1, 2, 3…) y la 'ParteCalculada' de 'calcularParte' (criterio 69).
  numero_parte integer CHECK (numero_parte >= 1),
  -- Obligatorio en boletas y facturas; 6b decide qué guardan las notas de crédito.
  detalle_parte jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'POR_ENVIAR'
    CHECK (estado IN ('POR_ENVIAR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ANULADO')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comprobante_sucursal_fk FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT comprobante_emisor_fk FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT comprobante_caja_fk FOREIGN KEY (caja_id, empresa_id) REFERENCES caja (id, empresa_id),
  CONSTRAINT comprobante_turno_fk FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id),
  CONSTRAINT comprobante_responsable_fk
    FOREIGN KEY (turno_responsable_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT comprobante_serie_fk FOREIGN KEY (serie_id, empresa_id) REFERENCES serie (id, empresa_id),
  CONSTRAINT comprobante_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT comprobante_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT comprobante_orden_parte_ck CHECK ((orden_id IS NULL) = (numero_parte IS NULL)),
  CONSTRAINT comprobante_cliente_ck CHECK (
    (cliente_tipo_documento IS NULL) = (cliente_numero IS NULL)
    AND (cliente_numero IS NULL) = (cliente_nombre IS NULL)
    AND (cliente_direccion IS NULL OR cliente_numero IS NOT NULL)
  ),
  CONSTRAINT comprobante_operaciones_ck CHECK (
    (tasa_igv IS NULL) = (op_gravadas IS NULL)
    AND (tasa_igv IS NULL) = (op_exoneradas IS NULL)
    AND (tasa_igv IS NULL) = (op_inafectas IS NULL)
    AND (tasa_igv IS NULL) = (op_gratuitas IS NULL)
  ),
  CONSTRAINT comprobante_total_ck CHECK (total = subtotal - descuentos + icbper),
  CONSTRAINT comprobante_total_operaciones_ck CHECK (
    tasa_igv IS NULL OR total = op_gravadas + op_exoneradas + op_inafectas + igv + icbper
  )
);
CREATE INDEX comprobante_empresa_id_idx ON comprobante (empresa_id);
CREATE UNIQUE INDEX comprobante_serie_numero_unico ON comprobante (empresa_id, serie_id, numero);
CREATE UNIQUE INDEX comprobante_cobro_unico ON comprobante (empresa_id, cobro_id) WHERE cobro_id IS NOT NULL;
-- Red contra dos partes de una orden con el mismo lugar.
CREATE UNIQUE INDEX comprobante_orden_parte_unica
  ON comprobante (empresa_id, orden_id, numero_parte) WHERE orden_id IS NOT NULL;
CREATE INDEX comprobante_sucursal_estado_idx ON comprobante (sucursal_id, estado);
CREATE INDEX comprobante_orden_idx ON comprobante (orden_id);
CREATE INDEX comprobante_turno_idx ON comprobante (turno_id);
${sqlTablaDeEmpresaTrazable('comprobante', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
-- Inmutable (criterio 78): el UPDATE de la API es solo del estado y de la trazabilidad de quien lo cambia. Nunca de
-- montos, de la serie ni de 'detalle_parte'.
GRANT UPDATE (estado, actualizado_en, actualizado_por_usuario_id, actualizado_por_equipo_id,
              actualizado_por_superadministrador_id, actualizado_por_sistema)
  ON comprobante TO restaurante_api;

CREATE TABLE comprobante_linea (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  comprobante_id uuid NOT NULL,
  posicion integer NOT NULL CHECK (posicion >= 1),
  item_id uuid,
  descripcion text NOT NULL CHECK (char_length(descripcion) BETWEEN 1 AND 250),
  cantidad integer NOT NULL CHECK (cantidad >= 1),
  -- 'NIU' en las líneas de un ítem; 'ZZ' en las "Por consumo".
  unidad text NOT NULL CHECK (unidad IN ('NIU', 'ZZ')),
  precio_unitario numeric(10, 2) NOT NULL CHECK (precio_unitario >= 0),
  valor_unitario numeric(20, 10) NOT NULL CHECK (valor_unitario >= 0),
  bruto numeric(10, 2) NOT NULL CHECK (bruto >= 0),
  descuento numeric(10, 2) NOT NULL CHECK (descuento >= 0),
  neto numeric(10, 2) NOT NULL CHECK (neto >= 0),
  base numeric(10, 2) NOT NULL CHECK (base >= 0),
  igv numeric(10, 2) NOT NULL CHECK (igv >= 0),
  bolsas integer NOT NULL CHECK (bolsas >= 0),
  icbper numeric(10, 2) NOT NULL CHECK (icbper >= 0),
  afectacion text NOT NULL CHECK (afectacion IN ('GRAVADO', 'EXONERADO', 'INAFECTO')),
  gratuita boolean NOT NULL,
  valor_referencial numeric(10, 2) CHECK (valor_referencial >= 0),
  base_referencial numeric(10, 2) CHECK (base_referencial >= 0),
  igv_referencial numeric(10, 2) CHECK (igv_referencial >= 0),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comprobante_linea_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT comprobante_linea_item_fk FOREIGN KEY (item_id, empresa_id) REFERENCES item (id, empresa_id),
  CONSTRAINT comprobante_linea_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT comprobante_linea_neto_ck CHECK (neto = bruto - descuento),
  CONSTRAINT comprobante_linea_desglose_ck CHECK (base + igv = neto),
  CONSTRAINT comprobante_linea_referencial_ck CHECK (
    gratuita = (valor_referencial IS NOT NULL)
    AND (base_referencial IS NULL) = (valor_referencial IS NULL)
    AND (igv_referencial IS NULL) = (valor_referencial IS NULL)
  ),
  CONSTRAINT comprobante_linea_gratuita_ck CHECK (
    NOT gratuita OR (bruto = 0 AND neto = 0 AND base_referencial + igv_referencial = valor_referencial)
  )
);
CREATE INDEX comprobante_linea_empresa_id_idx ON comprobante_linea (empresa_id);
CREATE UNIQUE INDEX comprobante_linea_posicion_unica
  ON comprobante_linea (empresa_id, comprobante_id, posicion);
${sqlTablaDeEmpresaTrazable('comprobante_linea', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

ALTER TABLE movimiento_caja
  ADD CONSTRAINT movimiento_caja_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id);
`;

const SQL_DOWN = `
ALTER TABLE movimiento_caja DROP CONSTRAINT movimiento_caja_comprobante_fk;
DROP TABLE comprobante_linea;
DROP TABLE comprobante;
DROP TABLE serie;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
