// Historia 006 · caja, cobro y comprobantes, entrega 6a, grupo C1 (criterios 1, 2, 24 a 35 y 102 a 105, plan
// "Migraciones" 2): las cajas y el turno. Los cobros y los pagos llegan con la migración `202611040004-cobros`.
//
// - `caja`: un punto de cobro de una sucursal ("Caja 1"), con su impresora opcional. El nombre es único en la
//   sucursal sin distinguir mayúsculas. Nunca se borra: se desactiva. Su llave `(id, sucursal_id, empresa_id)` respalda
//   la llave foránea compuesta de `turno`, que así no puede apuntar a la caja de otra sucursal.
// - `turno`: el periodo en que una persona responde por una caja. Clave primaria `(empresa_id, id)`: el `id` lo genera
//   la PWA y el mismo UUID en otra empresa crea su propia fila sin chocar (criterio 106). Dos índices únicos parciales
//   son la red contra dos turnos abiertos en una caja o de una persona (criterio 26); `huella_entrada` reconoce la
//   réplica de la apertura por `id` (criterio 24).
// - `turno_conteo`: lo contado, lo esperado y la diferencia de cada medio al cerrar (a ciegas, criterio 31); toda
//   diferencia lleva su motivo. `movimiento_caja`: ingresos y egresos de efectivo del turno; su `comprobante_id`
//   (nota de crédito de 6b) recibe la llave foránea en la migración de comprobantes.
// - Todas son tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api` (spec, "Permisos"): SELECT, INSERT y UPDATE en `caja` y `turno`; solo SELECT e INSERT en
//   `turno_conteo` y `movimiento_caja`. Nada se borra. Ninguna migración escribe datos.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const MEDIOS = `'EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'`;

const SQL_UP = `
CREATE TABLE caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 40),
  -- La impresora propia de la caja; nula, usa la impresora de caja de la sucursal (criterio 2).
  impresora_id uuid,
  activa boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caja_sucursal_fk FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT caja_impresora_fk FOREIGN KEY (impresora_id, empresa_id) REFERENCES impresora (id, empresa_id),
  CONSTRAINT caja_id_empresa_unico UNIQUE (id, empresa_id),
  -- Llave de turno: su caja es de la misma sucursal y de la misma empresa.
  CONSTRAINT caja_id_sucursal_empresa_unico UNIQUE (id, sucursal_id, empresa_id)
);
CREATE INDEX caja_empresa_id_idx ON caja (empresa_id);
CREATE UNIQUE INDEX caja_nombre_unico ON caja (empresa_id, sucursal_id, lower(nombre));
${sqlTablaDeEmpresaTrazable('caja', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE turno (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  caja_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  -- Quien abrió el turno y responde por la caja; no cambia.
  responsable_id uuid NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ABIERTO', 'CERRADO')),
  abierto_en timestamptz NOT NULL,
  -- Día operativo de la sucursal al abrir (hora de corte, B.9), para los reportes.
  dia_operativo date NOT NULL,
  fondo numeric(10, 2) NOT NULL CHECK (fondo >= 0),
  cerrado_en timestamptz,
  cerrado_por_id uuid,
  -- SHA-256 de la entrada normalizada, para reconocer la réplica por id (criterio 24).
  huella_entrada bytea NOT NULL CHECK (octet_length(huella_entrada) = 32),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT turno_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT turno_caja_fk
    FOREIGN KEY (caja_id, sucursal_id, empresa_id) REFERENCES caja (id, sucursal_id, empresa_id),
  CONSTRAINT turno_responsable_fk
    FOREIGN KEY (responsable_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT turno_cerrado_por_fk
    FOREIGN KEY (cerrado_por_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT turno_cierre_ck CHECK (
    (estado = 'CERRADO') = (cerrado_en IS NOT NULL) AND (cerrado_en IS NULL) = (cerrado_por_id IS NULL)
  )
);
CREATE INDEX turno_empresa_id_idx ON turno (empresa_id);
CREATE INDEX turno_sucursal_estado_idx ON turno (sucursal_id, estado);
-- Un turno abierto por caja y uno por persona en cada sucursal (criterio 26): la red de seguridad de la regla que
-- aplica la API.
CREATE UNIQUE INDEX turno_abierto_por_caja ON turno (empresa_id, caja_id) WHERE estado = 'ABIERTO';
CREATE UNIQUE INDEX turno_abierto_por_responsable
  ON turno (empresa_id, sucursal_id, responsable_id) WHERE estado = 'ABIERTO';
${sqlTablaDeEmpresaTrazable('turno', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE turno_conteo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  turno_id uuid NOT NULL,
  medio text NOT NULL CHECK (medio IN (${MEDIOS})),
  -- Lo que el sistema esperaba (puede ser negativo si hubo más egresos que efectivo), lo contado y la resta.
  esperado numeric(14, 2) NOT NULL,
  contado numeric(10, 2) NOT NULL CHECK (contado >= 0),
  diferencia numeric(14, 2) NOT NULL,
  motivo text CHECK (motivo IS NULL OR char_length(motivo) BETWEEN 1 AND 300),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT turno_conteo_turno_fk FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id),
  CONSTRAINT turno_conteo_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT turno_conteo_diferencia_ck CHECK (diferencia = contado - esperado),
  CONSTRAINT turno_conteo_motivo_ck CHECK (diferencia = 0 OR motivo IS NOT NULL)
);
CREATE INDEX turno_conteo_empresa_id_idx ON turno_conteo (empresa_id);
CREATE UNIQUE INDEX turno_conteo_medio_unico ON turno_conteo (empresa_id, turno_id, medio);
${sqlTablaDeEmpresaTrazable('turno_conteo', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE movimiento_caja (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  turno_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO')),
  -- En 6a la API solo escribe 'EFECTIVO'; 6b agrega los medios de la devolución de una nota de crédito.
  medio text NOT NULL DEFAULT 'EFECTIVO' CHECK (medio IN (${MEDIOS})),
  monto numeric(10, 2) NOT NULL CHECK (monto > 0),
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 300),
  -- La nota de crédito de la que sale una devolución (6b); la llave foránea llega con la tabla de comprobantes.
  comprobante_id uuid,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movimiento_caja_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT movimiento_caja_turno_fk FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id)
);
CREATE INDEX movimiento_caja_empresa_id_idx ON movimiento_caja (empresa_id);
CREATE INDEX movimiento_caja_turno_idx ON movimiento_caja (turno_id);
${sqlTablaDeEmpresaTrazable('movimiento_caja', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE movimiento_caja;
DROP TABLE turno_conteo;
DROP TABLE turno;
DROP TABLE caja;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
