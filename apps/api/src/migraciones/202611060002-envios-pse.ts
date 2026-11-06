// Historia 006 · caja, cobro y comprobantes, entrega 6b, grupo C7 (criterios 124 a 133, 163 y 167, plan "Migraciones" 10):
// el envío de cada comprobante al PSE y sus intentos. Dueño: facturación.
//
// - `envio_pse`: una fila por comprobante, que se inserta en la misma transacción de la emisión (criterio 124). Lleva el
//   estado del envío, los intentos hechos, cuándo toca el siguiente, el plazo de SUNAT, el arriendo del worker
//   (`en_curso_hasta` e `intento_en_curso`, criterio 125) y la última alerta. Los únicos que la escriben son la emisión
//   (INSERT), el worker y el barrido (UPDATE). Nadie la borra.
// - `intento_pse`: una fila por cada llamada al PSE (criterio 131): la operación, las horas, el resultado, el código y el
//   mensaje recortado. Nunca el documento enviado, el cuerpo de la respuesta ni la credencial. Solo se inserta.
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`); llaves foráneas compuestas con
//   `empresa_id`. `restaurante_plataforma` no recibe privilegios (la plataforma lee los envíos por la API del barrido).
//   Ninguna migración escribe datos.
//
// Los `CHECK` dan NULL con las columnas casi vacías (prueba de catálogo de 002, criterio 113). Las migraciones están
// exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const RESULTADOS = `'ACEPTADO', 'RECHAZADO', 'PENDIENTE', 'ERROR_TRANSPORTE', 'ERROR_CONFIGURACION'`;

const SQL_UP = `
CREATE TABLE envio_pse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  comprobante_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'ESPERANDO_RESPUESTA', 'TERMINADO', 'DETENIDO')),
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  -- Cuándo toca el siguiente intento; nulo si el envío terminó o se detuvo.
  proximo_intento_en timestamptz,
  -- El último instante para enviar (criterio 130).
  plazo_hasta timestamptz NOT NULL,
  -- El arriendo del worker (criterio 125): los dos juntos o ninguno.
  en_curso_hasta timestamptz,
  intento_en_curso uuid,
  ultimo_resultado text CHECK (ultimo_resultado IN (${RESULTADOS})),
  ultimo_error text CHECK (char_length(ultimo_error) BETWEEN 1 AND 500),
  -- La última alerta publicada y por qué motivo (criterio 133): evita repetirla.
  alertado_en timestamptz,
  alerta text CHECK (alerta IN ('RECHAZADO', 'DEMORADO', 'DETENIDO', 'SIN_CONFIGURACION')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT envio_pse_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT envio_pse_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT envio_pse_arriendo_ck CHECK ((en_curso_hasta IS NULL) = (intento_en_curso IS NULL)),
  CONSTRAINT envio_pse_terminado_ck CHECK (estado <> 'TERMINADO' OR en_curso_hasta IS NULL),
  CONSTRAINT envio_pse_alerta_ck CHECK ((alertado_en IS NULL) = (alerta IS NULL))
);
CREATE INDEX envio_pse_empresa_id_idx ON envio_pse (empresa_id);
-- Un envío por comprobante.
CREATE UNIQUE INDEX envio_pse_comprobante_unico ON envio_pse (empresa_id, comprobante_id);
-- El barrido busca los envíos vencidos (criterio 126).
CREATE INDEX envio_pse_estado_proximo_idx ON envio_pse (empresa_id, estado, proximo_intento_en);
${sqlTablaDeEmpresaTrazable('envio_pse', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE intento_pse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  envio_id uuid NOT NULL,
  comprobante_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero >= 1),
  operacion text NOT NULL CHECK (operacion IN ('EMITIR', 'CONSULTAR')),
  iniciado_en timestamptz NOT NULL,
  terminado_en timestamptz NOT NULL,
  resultado text NOT NULL CHECK (resultado IN (${RESULTADOS}, 'NO_EXISTE')),
  codigo text CHECK (char_length(codigo) BETWEEN 1 AND 50),
  mensaje text CHECK (char_length(mensaje) BETWEEN 1 AND 500),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intento_pse_envio_fk FOREIGN KEY (envio_id, empresa_id) REFERENCES envio_pse (id, empresa_id),
  CONSTRAINT intento_pse_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT intento_pse_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT intento_pse_horas_ck CHECK (terminado_en >= iniciado_en)
);
CREATE INDEX intento_pse_empresa_id_idx ON intento_pse (empresa_id);
CREATE INDEX intento_pse_envio_numero_idx ON intento_pse (envio_id, numero);
CREATE INDEX intento_pse_comprobante_idx ON intento_pse (comprobante_id);
${sqlTablaDeEmpresaTrazable('intento_pse', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE intento_pse;
DROP TABLE envio_pse;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
