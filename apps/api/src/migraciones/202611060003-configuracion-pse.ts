// Historia 006 · caja, cobro y comprobantes, entrega 6b, grupo C7 (criterios 122, 123 y 166, plan "Migraciones" 11): la
// configuración del PSE de cada emisor. Dueño: plataforma.
//
// - `configuracion_pse`: una fila por emisor con el `modo` (`SIMULADO` o `REAL`), el `conector` con que se pasó a `REAL` y
//   la credencial cifrada (`credencial`, AES-256-GCM en la aplicación; `clave_id` dice con qué clave) junto con los nombres
//   de sus campos, nunca sus valores (`campos_credencial`). Se escribe solo desde la ruta del superadministrador.
// - Tabla de empresa trazable (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). `restaurante_api` solo tiene SELECT
//   (el worker la lee con el contexto de la empresa); `restaurante_plataforma` tiene SELECT, INSERT y UPDATE. Nadie
//   borra. Ninguna migración escribe datos.
//
// Los `CHECK` dan NULL con las columnas casi vacías (prueba de catálogo de 002, criterio 113). Las migraciones están
// exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE configuracion_pse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  emisor_id uuid NOT NULL,
  modo text NOT NULL CHECK (modo IN ('SIMULADO', 'REAL')),
  -- El PSE_CONECTOR con que se pasó a REAL; nulo en SIMULADO.
  conector text CHECK (char_length(conector) BETWEEN 1 AND 40),
  -- Cifrada con AES-256-GCM: versión, id de clave, IV, etiqueta y cifrado. Nunca en claro.
  credencial bytea,
  -- Los nombres de los campos de la credencial (nunca los valores), para mostrarlos y auditarlos.
  campos_credencial text[] NOT NULL DEFAULT '{}',
  clave_id smallint,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT configuracion_pse_emisor_fk FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT configuracion_pse_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT configuracion_pse_credencial_ck CHECK ((credencial IS NULL) = (clave_id IS NULL)),
  CONSTRAINT configuracion_pse_real_ck CHECK (modo <> 'REAL' OR conector IS NOT NULL)
);
CREATE INDEX configuracion_pse_empresa_id_idx ON configuracion_pse (empresa_id);
-- Un emisor tiene a lo más una configuración.
CREATE UNIQUE INDEX configuracion_pse_emisor_unico ON configuracion_pse (empresa_id, emisor_id);
${sqlTablaDeEmpresaTrazable('configuracion_pse', {
  privilegiosApi: ['SELECT'],
  privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE'],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE configuracion_pse;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
