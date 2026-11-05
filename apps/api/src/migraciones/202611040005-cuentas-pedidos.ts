// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C3 (criterios 38 a 46, 81 y 89, plan "Migraciones" 5):
// lo que pedidos guarda de la cuenta.
//
// - `descuento`: un descuento por ítem (`item_id`) o por cuenta (`item_id` nulo), en porcentaje o en monto, con su
//   motivo, quién lo autorizó y con qué autorización (los dos nulos o los dos con valor). Se quita sin borrar la
//   fila (`quitado_en`, `quitado_por_id`: nulo si quitó una sesión de soporte, lo dice su trazabilidad). Clave
//   primaria `(empresa_id, id)`: el `id` lo genera la PWA y el mismo UUID en otra empresa crea su propia fila
//   (criterio 106). Dos índices únicos parciales hacen cumplir "uno vigente por ítem y uno por cuenta" (38 y 39);
//   `huella_entrada` reconoce la réplica por `id`.
// - `cortesia`: unidades de un ítem que no se cobran, con las mismas columnas de autorización y de quitar; a lo más
//   una vigente por ítem (43).
// - `contador_llamado`: el último número de llamado de la venta de mostrador de cada sucursal y día operativo (81).
// - Columnas nuevas de `orden` (el número de llamado y lo cobrado, para que pedidos conozca el estado de pago sin leer
//   las tablas de caja) y de `item` (`cantidad_facturada`, las unidades ya cobradas, nunca más que las vigentes).
// - `precuenta.descuentos` y `precuenta.cortesias` (decisión del desarrollador, ver el plan): la pre-cuenta guarda
//   los descuentos y las cortesías tal como se emitió (criterio 44), como ya guarda sus líneas y su total.
//
// Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de `restaurante_api`
// ("Permisos"): SELECT, INSERT y UPDATE (para quitar) en `descuento` y `cortesia`; SELECT, INSERT y UPDATE en
// `contador_llamado`. Nada se borra. Ninguna migración escribe datos.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE descuento (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL,
  -- El ítem descontado; nulo es el descuento de toda la cuenta.
  item_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('PORCENTAJE', 'MONTO')),
  valor numeric(10, 2) NOT NULL CHECK (valor > 0),
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 300),
  autorizado_por_id uuid,
  autorizacion_id uuid,
  quitado_en timestamptz,
  quitado_por_id uuid,
  -- SHA-256 de la entrada normalizada, para reconocer la réplica por id (criterio 46).
  huella_entrada bytea NOT NULL CHECK (octet_length(huella_entrada) = 32),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT descuento_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT descuento_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT descuento_item_fk FOREIGN KEY (item_id, empresa_id) REFERENCES item (id, empresa_id),
  CONSTRAINT descuento_autorizado_por_fk
    FOREIGN KEY (autorizado_por_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT descuento_autorizacion_fk
    FOREIGN KEY (autorizacion_id, empresa_id) REFERENCES autorizacion (id, empresa_id),
  CONSTRAINT descuento_quitado_por_fk
    FOREIGN KEY (quitado_por_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT descuento_autorizacion_ck CHECK ((autorizado_por_id IS NULL) = (autorizacion_id IS NULL)),
  CONSTRAINT descuento_quitado_ck CHECK (quitado_por_id IS NULL OR quitado_en IS NOT NULL)
);
CREATE INDEX descuento_empresa_id_idx ON descuento (empresa_id);
CREATE INDEX descuento_orden_idx ON descuento (orden_id);
CREATE INDEX descuento_item_idx ON descuento (item_id) WHERE item_id IS NOT NULL;
-- Uno vigente por ítem y uno por cuenta (criterios 38 y 39): la red de seguridad de la regla que aplica la API.
CREATE UNIQUE INDEX descuento_vigente_por_item
  ON descuento (empresa_id, item_id) WHERE quitado_en IS NULL AND item_id IS NOT NULL;
CREATE UNIQUE INDEX descuento_vigente_por_cuenta
  ON descuento (empresa_id, orden_id) WHERE quitado_en IS NULL AND item_id IS NULL;
${sqlTablaDeEmpresaTrazable('descuento', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE cortesia (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL,
  item_id uuid NOT NULL,
  cantidad integer NOT NULL CHECK (cantidad BETWEEN 1 AND 999),
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 300),
  autorizado_por_id uuid,
  autorizacion_id uuid,
  quitada_en timestamptz,
  quitada_por_id uuid,
  huella_entrada bytea NOT NULL CHECK (octet_length(huella_entrada) = 32),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cortesia_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT cortesia_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT cortesia_item_fk FOREIGN KEY (item_id, empresa_id) REFERENCES item (id, empresa_id),
  CONSTRAINT cortesia_autorizado_por_fk
    FOREIGN KEY (autorizado_por_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT cortesia_autorizacion_fk
    FOREIGN KEY (autorizacion_id, empresa_id) REFERENCES autorizacion (id, empresa_id),
  CONSTRAINT cortesia_quitada_por_fk
    FOREIGN KEY (quitada_por_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT cortesia_autorizacion_ck CHECK ((autorizado_por_id IS NULL) = (autorizacion_id IS NULL)),
  CONSTRAINT cortesia_quitada_ck CHECK (quitada_por_id IS NULL OR quitada_en IS NOT NULL)
);
CREATE INDEX cortesia_empresa_id_idx ON cortesia (empresa_id);
CREATE INDEX cortesia_orden_idx ON cortesia (orden_id);
CREATE INDEX cortesia_item_idx ON cortesia (item_id);
-- Una cortesía vigente por ítem (criterio 43).
CREATE UNIQUE INDEX cortesia_vigente_por_item ON cortesia (empresa_id, item_id) WHERE quitada_en IS NULL;
${sqlTablaDeEmpresaTrazable('cortesia', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE contador_llamado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  dia_operativo date NOT NULL,
  ultimo integer NOT NULL CHECK (ultimo >= 1),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contador_llamado_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT contador_llamado_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX contador_llamado_empresa_id_idx ON contador_llamado (empresa_id);
CREATE UNIQUE INDEX contador_llamado_dia_unico
  ON contador_llamado (empresa_id, sucursal_id, dia_operativo);
${sqlTablaDeEmpresaTrazable('contador_llamado', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

ALTER TABLE orden
  ADD COLUMN numero_llamado integer,
  ADD COLUMN dia_operativo_llamado date,
  ADD COLUMN monto_cobrado numeric(10, 2) NOT NULL DEFAULT 0,
  -- El ICBPER de lo ya cobrado, para el "por pagar" de la pre-cuenta (criterio 89).
  ADD COLUMN icbper_cobrado numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN cobros integer NOT NULL DEFAULT 0,
  ADD COLUMN modo_cobro text,
  ADD CONSTRAINT orden_llamado_ck CHECK (
    (numero_llamado IS NULL) = (dia_operativo_llamado IS NULL)
    AND (numero_llamado IS NULL OR (numero_llamado >= 1 AND tipo = 'MOSTRADOR'))
  ),
  ADD CONSTRAINT orden_monto_cobrado_ck CHECK (monto_cobrado >= 0),
  ADD CONSTRAINT orden_icbper_cobrado_ck CHECK (icbper_cobrado >= 0 AND icbper_cobrado <= monto_cobrado),
  ADD CONSTRAINT orden_cobros_ck CHECK (cobros >= 0),
  ADD CONSTRAINT orden_modo_cobro_ck CHECK (modo_cobro IS NULL OR modo_cobro IN ('ITEMS', 'IGUALES'));
-- La red del contador: ni dos ventas con el mismo llamado el mismo día (criterio 81).
CREATE UNIQUE INDEX orden_llamado_unico
  ON orden (empresa_id, sucursal_id, dia_operativo_llamado, numero_llamado)
  WHERE numero_llamado IS NOT NULL;

ALTER TABLE item
  ADD COLUMN cantidad_facturada integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT item_cantidad_facturada_ck
    CHECK (cantidad_facturada >= 0 AND cantidad_facturada <= cantidad - cantidad_anulada);

ALTER TABLE precuenta
  ADD COLUMN descuentos jsonb,
  ADD COLUMN cortesias jsonb;
`;

const SQL_DOWN = `
ALTER TABLE precuenta DROP COLUMN descuentos, DROP COLUMN cortesias;

ALTER TABLE item
  DROP CONSTRAINT item_cantidad_facturada_ck,
  DROP COLUMN cantidad_facturada;

DROP INDEX orden_llamado_unico;
ALTER TABLE orden
  DROP CONSTRAINT orden_modo_cobro_ck,
  DROP CONSTRAINT orden_cobros_ck,
  DROP CONSTRAINT orden_icbper_cobrado_ck,
  DROP CONSTRAINT orden_monto_cobrado_ck,
  DROP CONSTRAINT orden_llamado_ck,
  DROP COLUMN modo_cobro,
  DROP COLUMN cobros,
  DROP COLUMN icbper_cobrado,
  DROP COLUMN monto_cobrado,
  DROP COLUMN dia_operativo_llamado,
  DROP COLUMN numero_llamado;

DROP TABLE contador_llamado;
DROP TABLE cortesia;
DROP TABLE descuento;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
