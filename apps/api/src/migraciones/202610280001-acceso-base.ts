// Historia 002 · acceso base (C0): usuarios, accesos por sucursal, sesiones, bloqueos, idempotencia,
// superadministradores y la búsqueda de la empresa de un usuario al ingresar (criterios 4, 88 a 91).
//
// - Esquema `autenticacion` (dueño el migrador, sin acceso para PUBLIC ni para los roles de la aplicación)
//   con `nombre_usuario` (nombre → empresa y usuario). Lo mantiene un trigger `SECURITY DEFINER` sobre
//   `usuario` y solo lo lee `public.empresa_de_usuario(text)`, también `SECURITY DEFINER`. Como las
//   tablas de `public` tienen RLS forzada sin política para el migrador, la relación vive fuera de
//   `public` y sin RLS (como `contexto.sesion_empresa` en 001). La unicidad global del nombre es la
//   llave primaria de esa tabla: un nombre repetido en otra empresa falla con `23505`.
// - `usuario` y `acceso_sucursal` se crean aquí sin trazabilidad: la migración siguiente
//   (`trazabilidad`) les agrega las columnas y el trigger, igual que a `empresa`, `emisor` y `sucursal`.
//   `sesion`, `bloqueo_intentos` e `idempotencia` son las excepciones de la lista cerrada del criterio 113
//   y no la llevan nunca.
// - `sesion.equipo_id` y `sesion.equipo_recordado_id` quedan sin llave: las tablas `equipo` y
//   `equipo_recordado` llegan en la migración de equipos (C2), que las agrega.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresa, sqlTablaDePlataforma } from './sql-tabla-de-empresa';

const SQL_UP = `
-- Una sucursal solo puede ser referenciada junto con su empresa (llaves compuestas de las tablas nuevas).
ALTER TABLE sucursal ADD CONSTRAINT sucursal_id_empresa_unico UNIQUE (id, empresa_id);

-- ---------------------------------------------------------------------------------------------------
-- Esquema interno de autenticación y búsqueda del usuario al ingresar.
-- ---------------------------------------------------------------------------------------------------
CREATE SCHEMA autenticacion AUTHORIZATION restaurante_migrador;
REVOKE ALL ON SCHEMA autenticacion FROM PUBLIC;

CREATE TABLE autenticacion.nombre_usuario (
  nombre text NOT NULL CHECK (nombre ~ '^[a-z0-9._-]{3,50}$'),
  empresa_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  CONSTRAINT nombre_usuario_nombre_unico PRIMARY KEY (nombre),
  CONSTRAINT nombre_usuario_usuario_unico UNIQUE (usuario_id)
);
REVOKE ALL ON TABLE autenticacion.nombre_usuario FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------------
-- Superadministradores (personal de nuestra empresa): solo la vía de plataforma.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE superadministrador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario text NOT NULL CONSTRAINT superadministrador_usuario_unico UNIQUE
    CHECK (usuario ~ '^[a-z0-9._-]{3,50}$'),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  hash_contrasena text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  fallos_seguidos integer NOT NULL DEFAULT 0 CHECK (fallos_seguidos >= 0),
  bloqueado_hasta timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sesion_superadministrador (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  superadministrador_id uuid NOT NULL REFERENCES superadministrador (id),
  huella_secreto bytea NOT NULL,
  expira_en timestamptz NOT NULL,
  cerrada_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sesion_superadministrador_superadministrador_idx
  ON sesion_superadministrador (superadministrador_id);

CREATE TABLE idempotencia_plataforma (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clave uuid NOT NULL CONSTRAINT idempotencia_plataforma_clave_unica UNIQUE,
  ruta text NOT NULL,
  actor text NOT NULL,
  huella_entrada text NOT NULL,
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'completada')),
  estado_http integer,
  respuesta jsonb,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotencia_plataforma_creado_en_idx ON idempotencia_plataforma (creado_en);

${sqlTablaDePlataforma('superadministrador', ['SELECT', 'INSERT', 'UPDATE'])}
${sqlTablaDePlataforma('sesion_superadministrador', ['SELECT', 'INSERT', 'UPDATE'])}
${sqlTablaDePlataforma('idempotencia_plataforma', ['SELECT', 'INSERT', 'DELETE'])}

-- ---------------------------------------------------------------------------------------------------
-- Usuarios de la empresa y sus accesos por sucursal.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  nombre_usuario text NOT NULL CHECK (nombre_usuario ~ '^[a-z0-9._-]{3,50}$'),
  -- Todo usuario tiene contraseña (formato scrypt$15$8$1$<sal>$<hash>); nunca en claro.
  hash_contrasena text NOT NULL,
  contrasena_temporal boolean NOT NULL DEFAULT true,
  -- HMAC-SHA256 con el secreto del entorno (PIN_PEPPER); único en la empresa.
  huella_pin bytea NOT NULL,
  largo_pin smallint NOT NULL CHECK (largo_pin IN (4, 6)),
  -- Tramos semanales de acceso (el contenido lo valida la API); nulo = sin horario.
  horario jsonb CHECK (horario IS NULL OR (jsonb_typeof(horario) = 'array' AND jsonb_array_length(horario) > 0)),
  es_administrador boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT usuario_pin_unico UNIQUE (empresa_id, huella_pin),
  CONSTRAINT usuario_administrador_sin_horario CHECK (NOT es_administrador OR horario IS NULL)
);
CREATE INDEX usuario_empresa_id_idx ON usuario (empresa_id);

CREATE TABLE acceso_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  usuario_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  rol text NOT NULL CHECK (rol IN ('MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR')),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceso_sucursal_usuario_fk
    FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT acceso_sucursal_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT acceso_sucursal_usuario_sucursal_unico UNIQUE (usuario_id, sucursal_id)
);
CREATE INDEX acceso_sucursal_empresa_id_idx ON acceso_sucursal (empresa_id);
CREATE INDEX acceso_sucursal_sucursal_idx ON acceso_sucursal (sucursal_id);

-- Mantiene autenticacion.nombre_usuario: el nombre global (único en todo el sistema) de cada usuario.
-- SECURITY DEFINER (dueño el migrador, search_path fijo): la API no tiene acceso al esquema.
CREATE FUNCTION autenticacion.mantener_nombre_usuario() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO autenticacion.nombre_usuario (nombre, empresa_id, usuario_id)
    VALUES (NEW.nombre_usuario, NEW.empresa_id, NEW.id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.nombre_usuario IS DISTINCT FROM OLD.nombre_usuario THEN
      UPDATE autenticacion.nombre_usuario
         SET nombre = NEW.nombre_usuario
       WHERE usuario_id = OLD.id;
    END IF;
    RETURN NEW;
  END IF;
  DELETE FROM autenticacion.nombre_usuario WHERE usuario_id = OLD.id;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION autenticacion.mantener_nombre_usuario() FROM PUBLIC;
CREATE TRIGGER mantener_nombre_usuario
  AFTER INSERT OR UPDATE OF nombre_usuario OR DELETE ON usuario
  FOR EACH ROW EXECUTE FUNCTION autenticacion.mantener_nombre_usuario();

-- Empresa de un usuario por su nombre, para el ingreso (antes de saber la empresa). Coincidencia exacta,
-- sin distinguir mayúsculas ASCII (no es un LIKE: % y _ no son comodines) y sin otras reglas de
-- mayúsculas de Unicode (el nombre de usuario solo tiene a-z, 0-9, punto, guion y guion bajo).
CREATE FUNCTION public.empresa_de_usuario(p_usuario text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
  SELECT n.empresa_id
    FROM autenticacion.nombre_usuario n
   WHERE n.nombre = pg_catalog.translate(
           p_usuario,
           'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
           'abcdefghijklmnopqrstuvwxyz')
$fn$;
REVOKE ALL ON FUNCTION public.empresa_de_usuario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_de_usuario(text) TO restaurante_api;

-- ---------------------------------------------------------------------------------------------------
-- Sesiones, bloqueos e idempotencia (excepciones de la trazabilidad).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE sesion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  tipo text NOT NULL CHECK (tipo IN ('CONTRASENA', 'PIN', 'SOPORTE')),
  usuario_id uuid,
  superadministrador_id uuid REFERENCES superadministrador (id),
  -- Sin llave todavía: las tablas equipo y equipo_recordado llegan en la migración de equipos (C2).
  equipo_id uuid,
  equipo_recordado_id uuid,
  sucursal_id uuid,
  huella_secreto bytea NOT NULL,
  ultima_actividad_en timestamptz NOT NULL,
  expira_en timestamptz NOT NULL,
  minutos_inactividad integer NOT NULL CHECK (minutos_inactividad BETWEEN 1 AND 120),
  cerrada_en timestamptz,
  motivo_cierre text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sesion_usuario_fk FOREIGN KEY (usuario_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT sesion_sucursal_fk FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  -- Exactamente uno entre usuario y superadministrador, según el tipo.
  CONSTRAINT sesion_persona_ck CHECK (
    (tipo = 'SOPORTE' AND superadministrador_id IS NOT NULL AND usuario_id IS NULL)
    OR (tipo IN ('CONTRASENA', 'PIN') AND usuario_id IS NOT NULL AND superadministrador_id IS NULL)
  ),
  -- El equipo es obligatorio en PIN, opcional en contraseña (desde que se recuerda) y nulo en soporte.
  CONSTRAINT sesion_equipo_ck CHECK (
    (tipo <> 'PIN' OR (equipo_id IS NOT NULL AND equipo_recordado_id IS NOT NULL))
    AND (tipo <> 'SOPORTE' OR (equipo_id IS NULL AND equipo_recordado_id IS NULL))
    AND (equipo_recordado_id IS NULL OR equipo_id IS NOT NULL)
  )
);
CREATE INDEX sesion_empresa_id_idx ON sesion (empresa_id);
CREATE INDEX sesion_usuario_idx ON sesion (usuario_id) WHERE cerrada_en IS NULL;
CREATE INDEX sesion_superadministrador_idx ON sesion (superadministrador_id) WHERE cerrada_en IS NULL;
-- Un equipo tiene como máximo una sesión PIN abierta (cambio rápido de usuario).
CREATE UNIQUE INDEX sesion_pin_abierta_por_equipo ON sesion (equipo_id)
  WHERE tipo = 'PIN' AND cerrada_en IS NULL;

CREATE TABLE bloqueo_intentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  ambito text NOT NULL CHECK (ambito IN (
    'CONTRASENA_USUARIO', 'PIN_EQUIPO_RECORDADO', 'CLAVE_USUARIO', 'CLAVE_EQUIPO')),
  objetivo_id uuid NOT NULL,
  fallos_seguidos integer NOT NULL DEFAULT 0 CHECK (fallos_seguidos >= 0),
  ultimo_fallo_en timestamptz,
  bloqueado_hasta timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bloqueo_intentos_objetivo_unico UNIQUE (empresa_id, ambito, objetivo_id)
);

CREATE TABLE idempotencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  clave uuid NOT NULL,
  ruta text NOT NULL,
  actor text NOT NULL,
  huella_entrada text NOT NULL,
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'completada')),
  estado_http integer,
  respuesta jsonb,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotencia_clave_unica UNIQUE (empresa_id, clave)
);
CREATE INDEX idempotencia_creado_en_idx ON idempotencia (creado_en);

-- ---------------------------------------------------------------------------------------------------
-- RLS forzada, políticas y privilegios explícitos (convención del criterio 38 de 001 y criterio 88).
-- ---------------------------------------------------------------------------------------------------
${sqlTablaDeEmpresa('usuario', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: ['SELECT', 'INSERT'],
})}
${sqlTablaDeEmpresa('acceso_sucursal', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: ['SELECT'],
})}
${sqlTablaDeEmpresa('sesion', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: ['SELECT', 'INSERT', 'UPDATE'],
})}
${sqlTablaDeEmpresa('bloqueo_intentos', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  privilegiosPlataforma: [],
})}
${sqlTablaDeEmpresa('idempotencia', {
  privilegiosApi: ['SELECT', 'INSERT', 'DELETE'],
  privilegiosPlataforma: [],
})}
`;

const SQL_DOWN = `
DROP TABLE idempotencia;
DROP TABLE bloqueo_intentos;
DROP TABLE sesion;
DROP FUNCTION public.empresa_de_usuario(text);
DROP TRIGGER mantener_nombre_usuario ON usuario;
DROP FUNCTION autenticacion.mantener_nombre_usuario();
DROP TABLE acceso_sucursal;
DROP TABLE usuario;
DROP TABLE idempotencia_plataforma;
DROP TABLE sesion_superadministrador;
DROP TABLE superadministrador;
DROP TABLE autenticacion.nombre_usuario;
DROP SCHEMA autenticacion;
ALTER TABLE sucursal DROP CONSTRAINT sucursal_id_empresa_unico;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
