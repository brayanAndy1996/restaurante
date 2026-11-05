// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C4 (criterios 47 a 63, 102 a 105, plan "Migraciones" 4):
// los cobros y los pagos. Dueño: caja.
//
// - `cobro`: una parte cobrada de una orden. Clave primaria `(empresa_id, id)`: el `id` lo genera la PWA y se conserva
//   hasta una respuesta final; el mismo UUID en otra empresa crea su propia fila sin chocar (criterio 106). Lleva la
//   orden, el turno y el comprobante que emitió (único: un comprobante, un cobro), el modo (`TOTAL`, `ITEMS`,
//   `IGUALES`), la parte pedida tal como llegó normalizada, el total, el redondeo (de 0.00 a 0.09), el vuelto, la
//   huella de la entrada (réplica por `id`, criterio 55) y la respuesta original (réplica de los criterios 54 a 56).
//   El detalle calculado de la parte no vive aquí sino en `comprobante.detalle_parte` (facturación).
// - `pago`: cómo se pagó un cobro, un medio por fila. El efectivo no lleva operación; fuera del efectivo es obligatoria;
//   `recibido` solo existe en efectivo y no baja del monto.
//
// Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de `restaurante_api`
// (spec, "Permisos"): solo SELECT e INSERT en las dos. Nada se actualiza ni se borra. Ninguna migración escribe datos.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const MEDIOS = `'EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'`;

const SQL_UP = `
CREATE TABLE cobro (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL,
  turno_id uuid NOT NULL,
  comprobante_id uuid NOT NULL,
  -- El tipo de la parte: TOTAL, ITEMS o IGUALES.
  modo text NOT NULL CHECK (modo IN ('TOTAL', 'ITEMS', 'IGUALES')),
  -- La entrada normalizada (el ítem y la cantidad, o las partes restantes).
  parte jsonb NOT NULL,
  total numeric(10, 2) NOT NULL CHECK (total >= 0),
  redondeo numeric(10, 2) NOT NULL CHECK (redondeo BETWEEN 0 AND 0.09),
  vuelto numeric(10, 2) NOT NULL CHECK (vuelto >= 0),
  -- SHA-256 de la entrada normalizada (sin version ni total), para reconocer la réplica por id (criterio 55).
  huella_entrada bytea NOT NULL CHECK (octet_length(huella_entrada) = 32),
  -- La respuesta original, para devolverla igual en la réplica (criterios 54 a 56).
  respuesta jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cobro_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT cobro_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT cobro_turno_fk FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id),
  CONSTRAINT cobro_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  -- Un comprobante, un cobro. Se comprueba al confirmar (DEFERRABLE): la red de siempre es la clave primaria y el
  -- índice único de 'comprobante.cobro_id', que sí chocan al insertar; esta es la tercera, la de la relación inversa.
  CONSTRAINT cobro_comprobante_unico UNIQUE (empresa_id, comprobante_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX cobro_empresa_id_idx ON cobro (empresa_id);
CREATE INDEX cobro_orden_idx ON cobro (orden_id);
CREATE INDEX cobro_turno_idx ON cobro (turno_id);
${sqlTablaDeEmpresaTrazable('cobro', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  cobro_id uuid NOT NULL,
  turno_id uuid NOT NULL,
  medio text NOT NULL CHECK (medio IN (${MEDIOS})),
  monto numeric(10, 2) NOT NULL CHECK (monto > 0),
  -- Lo que entregó el cliente en efectivo (el vuelto es recibido menos monto).
  recibido numeric(10, 2),
  -- El número de operación o de voucher; obligatorio fuera del efectivo y prohibido en el efectivo.
  operacion text CHECK (operacion ~ '^[A-Za-z0-9-]{1,30}$'),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pago_cobro_fk FOREIGN KEY (cobro_id, empresa_id) REFERENCES cobro (id, empresa_id),
  CONSTRAINT pago_turno_fk FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id),
  CONSTRAINT pago_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT pago_operacion_ck CHECK ((medio = 'EFECTIVO') = (operacion IS NULL)),
  CONSTRAINT pago_recibido_ck CHECK (recibido IS NULL OR (medio = 'EFECTIVO' AND recibido >= monto))
);
CREATE INDEX pago_empresa_id_idx ON pago (empresa_id);
CREATE INDEX pago_cobro_idx ON pago (cobro_id);
CREATE INDEX pago_turno_medio_idx ON pago (turno_id, medio);
${sqlTablaDeEmpresaTrazable('pago', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE pago;
DROP TABLE cobro;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
