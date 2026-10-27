// Historia 001 · tablas de plataforma (empresa, emisor, sucursal, auditoria_plataforma), función
// empresa_actual(), RLS forzada, políticas, privilegios explícitos y triggers de la auditoría.
// El SQL nombra el parámetro `app.empresa_id`, que solo el servicio de contexto escribe desde código
// (la regla de ESLint del criterio 37 no se aplica a las migraciones: ver eslint.config.js).
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresa, sqlTablaDePlataforma } from './sql-tabla-de-empresa';

const SQL_UP = `
-- Esquema: PUBLIC no puede usar ni crear en public; solo los dos roles de la aplicación pueden usarlo.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO restaurante_api, restaurante_plataforma;

-- Empresa de la transacción. Falla con un SQLSTATE fijo si no hay contexto, para no devolver 0 filas
-- en silencio; si el valor no es un UUID, falla la conversión.
CREATE FUNCTION empresa_actual() RETURNS uuid
  LANGUAGE plpgsql STABLE
  AS $fn$
DECLARE
  valor text := current_setting('app.empresa_id', true);
BEGIN
  IF valor IS NULL OR valor = '' THEN
    RAISE EXCEPTION 'contexto de empresa ausente' USING ERRCODE = '42501';
  END IF;
  RETURN valor::uuid;
END
$fn$;
REVOKE ALL ON FUNCTION empresa_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION empresa_actual() TO restaurante_api;

CREATE TABLE empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 150),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emisor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  ruc char(11) NOT NULL CONSTRAINT emisor_ruc_unico UNIQUE CHECK (ruc ~ '^[0-9]{11}$'),
  razon_social text NOT NULL CHECK (char_length(razon_social) BETWEEN 1 AND 200),
  regimen text NOT NULL CHECK (regimen IN ('NUEVO_RUS', 'RER', 'MYPE_TRIBUTARIO', 'GENERAL')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emisor_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX emisor_empresa_id_idx ON emisor (empresa_id);

CREATE TABLE sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  emisor_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  codigo_establecimiento char(4) NOT NULL CHECK (codigo_establecimiento ~ '^\\d{4}$'),
  direccion text NOT NULL CHECK (char_length(direccion) BETWEEN 1 AND 300),
  horario jsonb NOT NULL DEFAULT '[]'::jsonb,
  whatsapp text CHECK (whatsapp ~ '^\\+519\\d{8}$'),
  hora_corte time NOT NULL DEFAULT '05:00',
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  -- Llave compuesta: una sucursal solo puede referenciar emisores de su propia empresa
  -- (las comprobaciones de llave foránea ignoran la RLS).
  CONSTRAINT sucursal_emisor_fk FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor (id, empresa_id),
  CONSTRAINT sucursal_emisor_codigo_unico UNIQUE (emisor_id, codigo_establecimiento)
);
CREATE INDEX sucursal_empresa_id_idx ON sucursal (empresa_id);
CREATE UNIQUE INDEX sucursal_empresa_nombre_unico ON sucursal (empresa_id, lower(nombre));

CREATE TABLE auditoria_plataforma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocurrido_en timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (btrim(actor) <> ''),
  operacion text NOT NULL CHECK (btrim(operacion) <> ''),
  motivo text NOT NULL CHECK (btrim(motivo) <> ''),
  empresa_id uuid REFERENCES empresa (id),
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX auditoria_plataforma_empresa_id_idx ON auditoria_plataforma (empresa_id);

-- La auditoría es inmutable: ni UPDATE, ni DELETE, ni TRUNCATE (tampoco para el dueño).
CREATE FUNCTION auditoria_plataforma_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $fn$
BEGIN
  RAISE EXCEPTION 'auditoria_plataforma es de solo agregar: % no está permitido', TG_OP
    USING ERRCODE = '42501';
END
$fn$;
REVOKE ALL ON FUNCTION auditoria_plataforma_inmutable() FROM PUBLIC;
CREATE TRIGGER auditoria_plataforma_sin_modificar
  BEFORE UPDATE OR DELETE ON auditoria_plataforma
  FOR EACH ROW EXECUTE FUNCTION auditoria_plataforma_inmutable();
CREATE TRIGGER auditoria_plataforma_sin_vaciar
  BEFORE TRUNCATE ON auditoria_plataforma
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_plataforma_inmutable();

-- RLS forzada, políticas y privilegios explícitos.
${sqlTablaDeEmpresa('empresa', {
  columnaEmpresa: 'id',
  privilegiosApi: ['SELECT', 'UPDATE'],
  privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE'],
})}
${sqlTablaDeEmpresa('emisor', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE'],
})}
${sqlTablaDeEmpresa('sucursal', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE'],
})}
${sqlTablaDePlataforma('auditoria_plataforma', ['SELECT', 'INSERT'])}
`;

const SQL_DOWN = `
DROP TABLE auditoria_plataforma;
DROP FUNCTION auditoria_plataforma_inmutable();
DROP TABLE sucursal;
DROP TABLE emisor;
DROP TABLE empresa;
DROP FUNCTION empresa_actual();
REVOKE USAGE ON SCHEMA public FROM restaurante_api, restaurante_plataforma;
GRANT USAGE ON SCHEMA public TO PUBLIC;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
