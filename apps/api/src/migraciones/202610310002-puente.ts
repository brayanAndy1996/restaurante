// Historia 004 · salón y cocina, entrega 3b, grupo C8 (criterios 101, 106 a 117 y 129 a 133): el puente de
// impresión, su vinculación y la cola de trabajos (RF-75, RF-77).
//
// - `puente`: la app del local vinculada a una sucursal. Guarda solo la huella SHA-256 del secreto de su credencial
//   `pu.<empresa>.<id>.<secreto>` (256 bits aleatorios, criterio 109). A lo sumo un puente activo por sucursal
//   (índice único parcial, criterio 108): al vincular otro, el anterior queda revocado (`activo = false`,
//   `revocado_en`; un `CHECK` ata las dos columnas). `ultima_senal_en` y `estado_impresoras` los mueven el socket y
//   el latido (criterios 111 y 120): `estado_impresoras` es un objeto `{ <impresoraId>: { estado, desde, error? } }`.
// - `vinculacion_puente`: el código `vi.<empresa>.<id>.<secreto>` de un solo uso y diez minutos (criterios 106 y
//   107). También guarda solo la huella. `usada_en` se fija con un `UPDATE … WHERE usada_en IS NULL` (una sola
//   petición gana); `invalidada_en`, cuando se crea otro código para la sucursal; `puente_id`, el puente que nació
//   con ella.
// - `trabajo_impresion`: un ticket en cola para una impresora (criterios 101, 113 a 117 y 126). Guarda el documento
//   lógico (`documentoTicket`), no bytes: los bytes se arman al entregarlo con la configuración vigente de la
//   impresora. `VENCIDO` no se guarda: se calcula al leer cuando pasó el `dia_operativo` (criterio 117). Un índice
//   único parcial impide un segundo trabajo de la misma comanda (los de reimpresión llevan `reimpresion_de_id`); el
//   de la pre-cuenta, que aquí es solo un índice de búsqueda, es único desde la migración `202610310004`.
//   Se agregan cuatro columnas que la especificación no lista, nulas y solo para la lista y la reimpresión de la
//   PWA (criterio 128): `mesa` (los nombres de las mesas), `estacion_id` (para reimprimir en la impresora actual
//   de la estación si la original está inactiva), `orden_id` y `envio_numero` (para que la cuenta muestre los
//   tickets de su orden).
// - Todos los únicos empiezan por `empresa_id` y las llaves foráneas son compuestas con `empresa_id` (criterios 84
//   y 131). Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE; nada se borra. Ninguna migración escribe datos.
//
// `down` borra las tres tablas con sus datos (las de impresoras, destinos e impresora de caja son de la anterior).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE puente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 60),
  modelo text CHECK (modelo IS NULL OR char_length(modelo) BETWEEN 1 AND 60),
  version_app text NOT NULL CHECK (char_length(version_app) BETWEEN 1 AND 30),
  -- SHA-256 del secreto de la credencial; el secreto no se guarda.
  huella_secreto bytea NOT NULL CHECK (octet_length(huella_secreto) = 32),
  activo boolean NOT NULL DEFAULT true,
  revocado_en timestamptz,
  ultima_senal_en timestamptz,
  estado_impresoras jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estado_impresoras) = 'object'),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT puente_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- Activo si y solo si no está revocado (criterio 108).
  CONSTRAINT puente_revocado_ck CHECK (activo = (revocado_en IS NULL)),
  CONSTRAINT puente_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX puente_empresa_id_idx ON puente (empresa_id);
-- Un solo puente activo por sucursal (criterio 108).
CREATE UNIQUE INDEX puente_activo_unico ON puente (empresa_id, sucursal_id) WHERE activo;
CREATE INDEX puente_sucursal_idx ON puente (empresa_id, sucursal_id, creado_en);
${sqlTablaDeEmpresaTrazable('puente', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE vinculacion_puente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  -- SHA-256 del secreto del código; el secreto no se guarda.
  huella_secreto bytea NOT NULL CHECK (octet_length(huella_secreto) = 32),
  expira_en timestamptz NOT NULL,
  usada_en timestamptz,
  invalidada_en timestamptz,
  -- El puente que nació con este código.
  puente_id uuid,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vinculacion_puente_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT vinculacion_puente_puente_fk
    FOREIGN KEY (puente_id, empresa_id) REFERENCES puente (id, empresa_id),
  CONSTRAINT vinculacion_puente_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX vinculacion_puente_empresa_id_idx ON vinculacion_puente (empresa_id);
-- Invalidar los códigos pendientes de la sucursal al crear otro (criterio 106).
CREATE INDEX vinculacion_puente_pendiente_idx ON vinculacion_puente (empresa_id, sucursal_id)
  WHERE usada_en IS NULL AND invalidada_en IS NULL;
${sqlTablaDeEmpresaTrazable('vinculacion_puente', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE trabajo_impresion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  impresora_id uuid NOT NULL,
  -- La estación de la comanda (nula en la pre-cuenta y la página de prueba).
  estacion_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('COMANDA', 'ADICION', 'MARCHAR', 'ANULACION', 'PRECUENTA', 'PRUEBA')),
  -- El documento lógico del ticket (documentoTicket de packages/contratos), no bytes (criterio 126).
  documento jsonb NOT NULL CHECK (jsonb_typeof(documento) = 'object'),
  comanda_id uuid,
  precuenta_id uuid,
  reimpresion_de_id uuid,
  -- La orden de origen de la comanda o de la pre-cuenta (no cambia al unir mesas; la API la resuelve a la
  -- principal al leer) y el número del envío de una COMANDA o ADICION (criterio 128).
  orden_id uuid,
  envio_numero integer CHECK (envio_numero IS NULL OR envio_numero >= 1),
  -- Los nombres de las mesas de la cuenta, separados por coma y recortados con "…" si pasan de 300 caracteres (la
  -- API los recorta al encolar); nulo en la página de prueba.
  mesa text CHECK (mesa IS NULL OR char_length(mesa) <= 300),
  estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'IMPRESO')),
  -- El día operativo de la sucursal al crearlo; pasado ese día, un pendiente es VENCIDO (criterio 117).
  dia_operativo date NOT NULL,
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error text CHECK (ultimo_error IS NULL OR char_length(ultimo_error) <= 200),
  entregado_en timestamptz,
  impreso_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trabajo_impresion_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT trabajo_impresion_impresora_fk
    FOREIGN KEY (impresora_id, sucursal_id, empresa_id)
    REFERENCES impresora (id, sucursal_id, empresa_id),
  CONSTRAINT trabajo_impresion_estacion_fk
    FOREIGN KEY (estacion_id, empresa_id) REFERENCES estacion (id, empresa_id),
  CONSTRAINT trabajo_impresion_comanda_fk
    FOREIGN KEY (comanda_id, empresa_id) REFERENCES comanda (id, empresa_id),
  CONSTRAINT trabajo_impresion_precuenta_fk
    FOREIGN KEY (precuenta_id, empresa_id) REFERENCES precuenta (id, empresa_id),
  CONSTRAINT trabajo_impresion_orden_fk
    FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT trabajo_impresion_reimpresion_fk
    FOREIGN KEY (reimpresion_de_id, empresa_id) REFERENCES trabajo_impresion (id, empresa_id),
  -- Un trabajo es de una comanda o de una pre-cuenta, no de las dos.
  CONSTRAINT trabajo_impresion_origen_ck CHECK (num_nonnulls(comanda_id, precuenta_id) <= 1),
  -- Impreso si y solo si tiene su fecha de impresión.
  CONSTRAINT trabajo_impresion_impreso_ck CHECK ((estado = 'IMPRESO') = (impreso_en IS NOT NULL)),
  CONSTRAINT trabajo_impresion_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX trabajo_impresion_empresa_id_idx ON trabajo_impresion (empresa_id);
-- La entrega del puente y la lista de la sucursal por estado y orden de creación (criterios 113 y 128).
CREATE INDEX trabajo_impresion_cola_idx
  ON trabajo_impresion (empresa_id, sucursal_id, estado, creado_en, id);
-- Los pendientes de cada impresora (criterios 105 y 121).
CREATE INDEX trabajo_impresion_impresora_idx ON trabajo_impresion (empresa_id, impresora_id)
  WHERE estado = 'PENDIENTE';
-- Una comanda, un trabajo (criterio 101); las reimpresiones llevan su propio reimpresion_de_id.
CREATE UNIQUE INDEX trabajo_impresion_comanda_unico ON trabajo_impresion (empresa_id, comanda_id)
  WHERE comanda_id IS NOT NULL AND reimpresion_de_id IS NULL;
CREATE INDEX trabajo_impresion_precuenta_idx ON trabajo_impresion (empresa_id, precuenta_id)
  WHERE precuenta_id IS NOT NULL;
${sqlTablaDeEmpresaTrazable('trabajo_impresion', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE trabajo_impresion;
DROP TABLE vinculacion_puente;
DROP TABLE puente;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
