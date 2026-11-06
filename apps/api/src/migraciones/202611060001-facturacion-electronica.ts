// Historia 006 · caja, cobro y comprobantes, entrega 6b, grupo C7 (criterios 122, 124 a 127, 134, 143 a 152, plan
// "Migraciones" 9): lo que la facturación electrónica agrega a las tablas de 6a. Dueños: facturación (`comprobante`,
// `comprobante_linea`, `serie`) y caja (`movimiento_caja`).
//
// - `comprobante`: `cobro_id`, `turno_id` y `detalle_parte` admiten nulo (las notas de crédito no nacen de un cobro y,
//   sin devolución, tampoco tienen turno); `tipo` admite las dos notas de crédito; columnas nuevas de la nota
//   (`afecta_a_id`, `tipo_nota`, `motivo_nota`), de la reemisión (`reemplaza_a_id`, `motivo_reemplazo`), `simulado` y las de
//   la respuesta del PSE (`enviado_en`… `pdf_clave`). Todo `CHECK` nuevo da NULL, y no false, con `tipo` nulo y las demás
//   columnas en su valor por defecto: la prueba de catálogo de 002 (criterio 113) los prueba con filas casi vacías.
// - Disparador `comprobante_transicion` (`BEFORE UPDATE`): solo deja pasar las transiciones del criterio 127 y rechaza con
//   `23514`, también desde SQL directo, cambiar una marca de tiempo ya fijada. Un `UPDATE` que no cambia el estado pasa.
//   Es la red de `transicionPermitida` de `packages/dominio`.
// - `GRANT UPDATE` por columna a `restaurante_api` solo en las de estado y respuesta del PSE (nunca en montos, serie,
//   número, cliente, vínculos ni `simulado`). Índice único parcial de `reemplaza_a_id`: un rechazado tiene a lo más una
//   reemisión (criterio 134).
// - `comprobante_linea.posicion_origen`: la línea del original que acredita una línea de una nota (criterio 147).
// - `serie.tipo` y `serie_forma_ck` con las dos series de nota de crédito (`B…` para boletas, `F…` para facturas).
// - `movimiento_caja.operacion` y sus `CHECK` (criterio 150): la devolución de una nota fuera del efectivo lleva el número
//   de operación y apunta a la nota.
//
// No escribe datos. `down` deshace solo lo suyo, vuelve a poner los `NOT NULL` y los `CHECK` de 6a y falla si ya hay notas,
// reemisiones o facturas de cambio (por diseño, como la migración 7).
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';

const NOTAS = `'NOTA_CREDITO_BOLETA', 'NOTA_CREDITO_FACTURA'`;

const SQL_UP = `
-- comprobante: nulos nuevos, tipos nuevos y columnas de 6b
ALTER TABLE comprobante
  ALTER COLUMN cobro_id DROP NOT NULL,
  ALTER COLUMN turno_id DROP NOT NULL,
  ALTER COLUMN detalle_parte DROP NOT NULL;

ALTER TABLE comprobante DROP CONSTRAINT comprobante_tipo_check;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_tipo_check
  CHECK (tipo IN ('BOLETA', 'FACTURA', ${NOTAS}));

ALTER TABLE comprobante
  ADD COLUMN afecta_a_id uuid,
  ADD COLUMN tipo_nota text CHECK (tipo_nota IN ('ANULACION', 'DEVOLUCION')),
  ADD COLUMN motivo_nota text CHECK (char_length(motivo_nota) BETWEEN 1 AND 300),
  ADD COLUMN reemplaza_a_id uuid,
  ADD COLUMN motivo_reemplazo text CHECK (motivo_reemplazo IN ('REEMISION', 'CAMBIO_A_FACTURA')),
  -- El modo de PSE del emisor en el instante de emitir (criterio 122): copiado, nunca recalculado.
  ADD COLUMN simulado boolean NOT NULL DEFAULT false,
  ADD COLUMN enviado_en timestamptz,
  ADD COLUMN aceptado_en timestamptz,
  ADD COLUMN rechazado_en timestamptz,
  ADD COLUMN anulado_en timestamptz,
  ADD COLUMN sunat_codigo text CHECK (char_length(sunat_codigo) BETWEEN 1 AND 50),
  ADD COLUMN sunat_mensaje text CHECK (char_length(sunat_mensaje) BETWEEN 1 AND 500),
  ADD COLUMN sunat_observaciones jsonb CHECK (
    sunat_observaciones IS NULL
    OR (jsonb_typeof(sunat_observaciones) = 'array' AND jsonb_array_length(sunat_observaciones) <= 20)),
  ADD COLUMN hash text CHECK (char_length(hash) BETWEEN 1 AND 200),
  ADD COLUMN referencia_pse text CHECK (char_length(referencia_pse) BETWEEN 1 AND 200),
  ADD COLUMN xml_clave text CHECK (char_length(xml_clave) BETWEEN 1 AND 300),
  ADD COLUMN cdr_clave text CHECK (char_length(cdr_clave) BETWEEN 1 AND 300),
  ADD COLUMN pdf_clave text CHECK (char_length(pdf_clave) BETWEEN 1 AND 300),
  ADD CONSTRAINT comprobante_afecta_a_fk
    FOREIGN KEY (afecta_a_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  ADD CONSTRAINT comprobante_reemplaza_a_fk
    FOREIGN KEY (reemplaza_a_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  -- Solo las notas de crédito modifican otro documento, y lo hacen con su tipo y su motivo.
  ADD CONSTRAINT comprobante_nota_afecta_ck CHECK ((tipo IN ('BOLETA', 'FACTURA')) = (afecta_a_id IS NULL)),
  ADD CONSTRAINT comprobante_nota_datos_ck CHECK (
    (afecta_a_id IS NULL) = (tipo_nota IS NULL) AND (tipo_nota IS NULL) = (motivo_nota IS NULL)),
  ADD CONSTRAINT comprobante_reemplazo_ck CHECK ((reemplaza_a_id IS NULL) = (motivo_reemplazo IS NULL)),
  -- Lo que nace de un cobro no es una reemisión, y viceversa (criterio 136).
  ADD CONSTRAINT comprobante_cobro_reemplazo_ck CHECK (cobro_id IS NULL OR reemplaza_a_id IS NULL),
  ADD CONSTRAINT comprobante_cobro_detalle_ck CHECK ((cobro_id IS NULL) = (detalle_parte IS NULL)),
  ADD CONSTRAINT comprobante_origen_ck CHECK (
    tipo NOT IN ('BOLETA', 'FACTURA') OR cobro_id IS NOT NULL OR reemplaza_a_id IS NOT NULL),
  ADD CONSTRAINT comprobante_turno_nota_ck CHECK (turno_id IS NOT NULL OR tipo IN (${NOTAS})),
  ADD CONSTRAINT comprobante_rechazado_ck CHECK (estado <> 'RECHAZADO' OR rechazado_en IS NOT NULL),
  ADD CONSTRAINT comprobante_aceptado_ck CHECK (estado <> 'ACEPTADO' OR aceptado_en IS NOT NULL),
  ADD CONSTRAINT comprobante_anulado_ck CHECK (estado <> 'ANULADO' OR anulado_en IS NOT NULL);

-- Un rechazado tiene a lo más una reemisión: la red de dos reemisiones simultáneas (criterio 134).
CREATE UNIQUE INDEX comprobante_reemplaza_a_unico
  ON comprobante (empresa_id, reemplaza_a_id) WHERE reemplaza_a_id IS NOT NULL;
CREATE INDEX comprobante_afecta_a_idx ON comprobante (afecta_a_id);
CREATE INDEX comprobante_empresa_estado_emitido_idx ON comprobante (empresa_id, estado, emitido_en);

-- Solo estado y respuesta del PSE (criterio 78 y 127): nunca montos, serie, número, cliente, vínculos ni 'simulado'.
GRANT UPDATE (enviado_en, aceptado_en, rechazado_en, anulado_en, sunat_codigo, sunat_mensaje,
              sunat_observaciones, hash, referencia_pse, xml_clave, cdr_clave, pdf_clave)
  ON comprobante TO restaurante_api;

-- Las transiciones del criterio 127 (las mismas de 'transicionPermitida'): ninguna otra, ni siquiera desde SQL directo.
CREATE FUNCTION comprobante_transicion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
    (OLD.estado = 'POR_ENVIAR' AND NEW.estado IN ('ENVIADO', 'ACEPTADO', 'RECHAZADO'))
    OR (OLD.estado = 'ENVIADO' AND NEW.estado IN ('ACEPTADO', 'RECHAZADO'))
    OR (OLD.estado = 'ACEPTADO' AND NEW.estado = 'ANULADO')
  ) THEN
    RAISE EXCEPTION 'Transición de estado no permitida: % a %', OLD.estado, NEW.estado
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion';
  END IF;
  -- Cada marca de tiempo se fija una sola vez.
  IF (OLD.enviado_en IS NOT NULL AND NEW.enviado_en IS DISTINCT FROM OLD.enviado_en)
     OR (OLD.aceptado_en IS NOT NULL AND NEW.aceptado_en IS DISTINCT FROM OLD.aceptado_en)
     OR (OLD.rechazado_en IS NOT NULL AND NEW.rechazado_en IS DISTINCT FROM OLD.rechazado_en)
     OR (OLD.anulado_en IS NOT NULL AND NEW.anulado_en IS DISTINCT FROM OLD.anulado_en) THEN
    RAISE EXCEPTION 'Una marca de tiempo ya fijada no cambia'
      USING ERRCODE = '23514', CONSTRAINT = 'comprobante_transicion';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER comprobante_transicion BEFORE UPDATE ON comprobante
  FOR EACH ROW EXECUTE FUNCTION comprobante_transicion();

-- comprobante_linea: la línea del original que acredita una línea de una nota
ALTER TABLE comprobante_linea
  ADD COLUMN posicion_origen integer CHECK (posicion_origen >= 1);

-- serie: las series de las notas de crédito
ALTER TABLE serie DROP CONSTRAINT serie_tipo_check;
ALTER TABLE serie ADD CONSTRAINT serie_tipo_check CHECK (tipo IN ('BOLETA', 'FACTURA', ${NOTAS}));
ALTER TABLE serie DROP CONSTRAINT serie_forma_ck;
ALTER TABLE serie ADD CONSTRAINT serie_forma_ck CHECK (
  (tipo IN ('BOLETA', 'NOTA_CREDITO_BOLETA') AND serie ~ '^B[A-Z0-9]{3}$')
  OR (tipo IN ('FACTURA', 'NOTA_CREDITO_FACTURA') AND serie ~ '^F[A-Z0-9]{3}$'));

-- movimiento_caja: la operación de la devolución fuera del efectivo (criterio 150)
ALTER TABLE movimiento_caja
  ADD COLUMN operacion text CHECK (operacion ~ '^[A-Za-z0-9-]{1,30}$'),
  ADD CONSTRAINT movimiento_caja_operacion_ck CHECK ((medio = 'EFECTIVO') = (operacion IS NULL)),
  ADD CONSTRAINT movimiento_caja_medio_devolucion_ck CHECK (medio = 'EFECTIVO' OR comprobante_id IS NOT NULL),
  ADD CONSTRAINT movimiento_caja_nota_egreso_ck CHECK (comprobante_id IS NULL OR tipo = 'EGRESO');
CREATE INDEX movimiento_caja_comprobante_idx ON movimiento_caja (comprobante_id)
  WHERE comprobante_id IS NOT NULL;
`;

const SQL_DOWN = `
DROP INDEX movimiento_caja_comprobante_idx;
ALTER TABLE movimiento_caja
  DROP CONSTRAINT movimiento_caja_nota_egreso_ck,
  DROP CONSTRAINT movimiento_caja_medio_devolucion_ck,
  DROP CONSTRAINT movimiento_caja_operacion_ck,
  DROP COLUMN operacion;

ALTER TABLE serie DROP CONSTRAINT serie_forma_ck;
ALTER TABLE serie ADD CONSTRAINT serie_forma_ck CHECK (
  (tipo = 'BOLETA' AND serie ~ '^B[A-Z0-9]{3}$') OR (tipo = 'FACTURA' AND serie ~ '^F[A-Z0-9]{3}$'));
ALTER TABLE serie DROP CONSTRAINT serie_tipo_check;
ALTER TABLE serie ADD CONSTRAINT serie_tipo_check CHECK (tipo IN ('BOLETA', 'FACTURA'));

ALTER TABLE comprobante_linea DROP COLUMN posicion_origen;

DROP TRIGGER comprobante_transicion ON comprobante;
DROP FUNCTION comprobante_transicion();
DROP INDEX comprobante_empresa_estado_emitido_idx;
DROP INDEX comprobante_afecta_a_idx;
DROP INDEX comprobante_reemplaza_a_unico;

ALTER TABLE comprobante
  DROP CONSTRAINT comprobante_anulado_ck,
  DROP CONSTRAINT comprobante_aceptado_ck,
  DROP CONSTRAINT comprobante_rechazado_ck,
  DROP CONSTRAINT comprobante_turno_nota_ck,
  DROP CONSTRAINT comprobante_origen_ck,
  DROP CONSTRAINT comprobante_cobro_detalle_ck,
  DROP CONSTRAINT comprobante_cobro_reemplazo_ck,
  DROP CONSTRAINT comprobante_reemplazo_ck,
  DROP CONSTRAINT comprobante_nota_datos_ck,
  DROP CONSTRAINT comprobante_nota_afecta_ck,
  DROP CONSTRAINT comprobante_reemplaza_a_fk,
  DROP CONSTRAINT comprobante_afecta_a_fk,
  DROP COLUMN pdf_clave,
  DROP COLUMN cdr_clave,
  DROP COLUMN xml_clave,
  DROP COLUMN referencia_pse,
  DROP COLUMN hash,
  DROP COLUMN sunat_observaciones,
  DROP COLUMN sunat_mensaje,
  DROP COLUMN sunat_codigo,
  DROP COLUMN anulado_en,
  DROP COLUMN rechazado_en,
  DROP COLUMN aceptado_en,
  DROP COLUMN enviado_en,
  DROP COLUMN simulado,
  DROP COLUMN motivo_reemplazo,
  DROP COLUMN reemplaza_a_id,
  DROP COLUMN motivo_nota,
  DROP COLUMN tipo_nota,
  DROP COLUMN afecta_a_id;

-- Falla si ya hay notas, reemisiones o facturas de cambio (filas sin cobro, sin turno o de los tipos nuevos).
ALTER TABLE comprobante DROP CONSTRAINT comprobante_tipo_check;
ALTER TABLE comprobante ADD CONSTRAINT comprobante_tipo_check CHECK (tipo IN ('BOLETA', 'FACTURA'));
ALTER TABLE comprobante
  ALTER COLUMN cobro_id SET NOT NULL,
  ALTER COLUMN turno_id SET NOT NULL,
  ALTER COLUMN detalle_parte SET NOT NULL;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
