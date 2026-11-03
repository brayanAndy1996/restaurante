// Historia 005 · carta web y pedido desde la mesa con QR, grupo C1 (criterios 1 a 5 y 12, 13, 62 a 65): la
// configuración de la carta web (RF-40) y la búsqueda pública de la empresa por su dirección.
//
// - `carta_web`: una por empresa (nombre que ve el cliente, dirección, color y la clave del logo en el almacén de
//   archivos). `carta_web_sucursal`: la dirección y la publicación de cada sucursal; una sucursal sin fila no tiene
//   carta web. La dirección de la sucursal es única dentro de la empresa; la de la empresa, en todo el sistema.
// - La unicidad global de la dirección de la empresa no puede ser un índice de `carta_web`: la RLS impide ver las
//   filas de otra empresa, pero un índice único sí las ve, y el error revelaría que la dirección existe sin dar de
//   quién. La relación dirección -> empresa vive en el espejo `carta_publica.empresa_slug`, fuera de `public` y
//   sin acceso para los roles de la aplicación (como `autenticacion.nombre_usuario` de 002): lo mantiene el trigger
//   `SECURITY DEFINER` `carta_publica.mantener_slug()` y solo lo lee `public.empresa_de_carta(text)`, también
//   `SECURITY DEFINER`. Una dirección repetida falla con `23505` en la llave primaria del espejo, dentro de la
//   misma transacción, y la API la traduce a 409 `CONFLICTO` sin decir de quién es.
// - El migrador no tiene política en las tablas de `public` (RLS forzada), así que una función suya no podría
//   leer `carta_web`: por eso existe el espejo. El trigger toma la empresa de `NEW.empresa_id`, que la política
//   `WITH CHECK` de `carta_web` ya obligó a ser la del contexto (criterio 65).
// - `empresa_de_carta(text)` devuelve la empresa de la dirección exacta (la API la pasa a minúsculas antes) o `null`.
//   No es un `LIKE`: `%` y `_` no son comodines. `EXECUTE` solo para `restaurante_api`.
// - Tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api`: SELECT, INSERT y UPDATE; nada se borra. Ninguna migración escribe datos.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
-- ---------------------------------------------------------------------------------------------------
-- Esquema interno del espejo público (dueño el migrador, sin acceso para PUBLIC ni para la aplicación).
-- ---------------------------------------------------------------------------------------------------
CREATE SCHEMA carta_publica AUTHORIZATION restaurante_migrador;
REVOKE ALL ON SCHEMA carta_publica FROM PUBLIC;

CREATE TABLE carta_publica.empresa_slug (
  slug text NOT NULL,
  empresa_id uuid NOT NULL,
  CONSTRAINT empresa_slug_pk PRIMARY KEY (slug),
  CONSTRAINT empresa_slug_empresa_unica UNIQUE (empresa_id)
);
-- Defensa en profundidad: RLS activada sin políticas (el dueño, que ejecuta las funciones SECURITY DEFINER, la
-- usa igual porque no es FORCE). Ningún rol de la aplicación tiene ni siquiera USAGE del esquema.
ALTER TABLE carta_publica.empresa_slug ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE carta_publica.empresa_slug FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------------
-- La carta web de la empresa y de cada sucursal.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE carta_web (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
  slug text NOT NULL CHECK (char_length(slug) BETWEEN 3 AND 40 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  color_principal char(7) NOT NULL CHECK (color_principal ~ '^#[0-9A-F]{6}$'),
  logo_clave text CHECK (logo_clave IS NULL OR char_length(logo_clave) BETWEEN 1 AND 300),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carta_web_id_empresa_unico UNIQUE (id, empresa_id),
  -- Una carta web por empresa.
  CONSTRAINT carta_web_empresa_unica UNIQUE (empresa_id)
);
CREATE INDEX carta_web_empresa_id_idx ON carta_web (empresa_id);
${sqlTablaDeEmpresaTrazable('carta_web', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE carta_web_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  slug text NOT NULL CHECK (char_length(slug) BETWEEN 3 AND 40 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  publicada boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carta_web_sucursal_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT carta_web_sucursal_id_empresa_unico UNIQUE (id, empresa_id),
  -- Una fila por sucursal y una dirección por sucursal dentro de la empresa. Las unicidades llevan empresa_id
  -- primero: un índice único sin él vería la fila de otra empresa y un id ajeno daría 23505 en lugar del 23503
  -- de la llave foránea, revelando que existe (criterio 64).
  CONSTRAINT carta_web_sucursal_sucursal_unica UNIQUE (empresa_id, sucursal_id),
  CONSTRAINT carta_web_sucursal_slug_unico UNIQUE (empresa_id, slug)
);
CREATE INDEX carta_web_sucursal_empresa_id_idx ON carta_web_sucursal (empresa_id);
${sqlTablaDeEmpresaTrazable('carta_web_sucursal', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

-- ---------------------------------------------------------------------------------------------------
-- El espejo: dirección -> empresa. SECURITY DEFINER (dueño el migrador, search_path fijo): la API no tiene
-- acceso al esquema. Toma la empresa de la fila nueva, que la política WITH CHECK ya obligó a ser la del contexto.
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION carta_publica.mantener_slug() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO carta_publica.empresa_slug (slug, empresa_id) VALUES (NEW.slug, NEW.empresa_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      UPDATE carta_publica.empresa_slug SET slug = NEW.slug WHERE empresa_id = OLD.empresa_id;
    END IF;
    RETURN NEW;
  END IF;
  DELETE FROM carta_publica.empresa_slug WHERE empresa_id = OLD.empresa_id;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION carta_publica.mantener_slug() FROM PUBLIC;
CREATE TRIGGER mantener_slug
  AFTER INSERT OR UPDATE OF slug OR DELETE ON carta_web
  FOR EACH ROW EXECUTE FUNCTION carta_publica.mantener_slug();

-- Empresa de una carta web por su dirección, para las rutas públicas (antes de saber la empresa). Coincidencia
-- exacta (la API pasa la dirección a minúsculas antes), no un LIKE: % y _ no son comodines. Devuelve solo un uuid.
CREATE FUNCTION public.empresa_de_carta(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
  SELECT s.empresa_id
    FROM carta_publica.empresa_slug s
   WHERE s.slug = p_slug
$fn$;
REVOKE ALL ON FUNCTION public.empresa_de_carta(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_de_carta(text) TO restaurante_api;
`;

const SQL_DOWN = `
DROP FUNCTION public.empresa_de_carta(text);
DROP TRIGGER mantener_slug ON carta_web;
DROP FUNCTION carta_publica.mantener_slug();
DROP TABLE carta_web_sucursal;
DROP TABLE carta_web;
DROP TABLE carta_publica.empresa_slug;
DROP SCHEMA carta_publica;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
