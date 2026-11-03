// Historia 005 · carta web y pedido desde la mesa con QR, grupo C1 (criterios 6 a 10, 12, 13 y 62 a 65): el código
// QR de cada mesa (RF-84, HU-42) y su búsqueda pública.
//
// - `mesa_qr`: el código de la mesa (22 caracteres base64url de 128 bits al azar, que genera solo la API) y cuándo
//   se generó. Una fila por mesa. La llave foránea compuesta `(mesa_id, sucursal_id, empresa_id)` obliga a que la
//   sucursal sea la de la mesa (para listar la hoja de una sucursal sin unir) y a que ambas sean de la empresa; para
//   eso se agrega a `mesa` la llave única `(id, sucursal_id, empresa_id)`.
// - Cambiar el QR actualiza el código de la misma fila: el trigger `carta_publica.mantener_codigo_mesa()` borra el
//   código viejo del espejo y pone el nuevo en la misma transacción, así que desde la confirmación el viejo ya no
//   se encuentra (criterio 9). El espejo `carta_publica.codigo_mesa` vive fuera de `public`, sin acceso para los
//   roles de la aplicación, y solo lo lee `public.empresa_de_codigo_mesa(text)` (`SECURITY DEFINER`, búsqueda
//   exacta que distingue mayúsculas, `EXECUTE` solo para `restaurante_api`). Mismo diseño que 202611020001.
// - Las mesas que ya existen no reciben código en la migración: lo crea `POST /sucursales/:sucursalId/qr-mesas`,
//   porque el código lo genera la API (criterio 8).
// - Tabla de empresa trazable con `llaveDeEquipo`; privilegios de `restaurante_api`: SELECT, INSERT y UPDATE.
//
// Las migraciones están exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
ALTER TABLE mesa ADD CONSTRAINT mesa_id_sucursal_empresa_unico UNIQUE (id, sucursal_id, empresa_id);

CREATE TABLE carta_publica.codigo_mesa (
  codigo text NOT NULL,
  empresa_id uuid NOT NULL,
  CONSTRAINT codigo_mesa_pk PRIMARY KEY (codigo)
);
ALTER TABLE carta_publica.codigo_mesa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE carta_publica.codigo_mesa FROM PUBLIC;

CREATE TABLE mesa_qr (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  mesa_id uuid NOT NULL,
  sucursal_id uuid NOT NULL,
  codigo text NOT NULL CHECK (codigo ~ '^[A-Za-z0-9_-]{22}$'),
  generado_en timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mesa_qr_mesa_fk
    FOREIGN KEY (mesa_id, sucursal_id, empresa_id) REFERENCES mesa (id, sucursal_id, empresa_id),
  CONSTRAINT mesa_qr_id_empresa_unico UNIQUE (id, empresa_id),
  -- Un código por mesa (con empresa_id primero: una mesa ajena debe dar 23503 por la llave foránea, no 23505) y
  -- un código en todo el sistema (un código al azar de 128 bits no se repite; ver crearParaMesas).
  CONSTRAINT mesa_qr_mesa_unica UNIQUE (empresa_id, mesa_id),
  CONSTRAINT mesa_qr_codigo_unico UNIQUE (codigo)
);
CREATE INDEX mesa_qr_empresa_id_idx ON mesa_qr (empresa_id);
CREATE INDEX mesa_qr_sucursal_idx ON mesa_qr (empresa_id, sucursal_id);
${sqlTablaDeEmpresaTrazable('mesa_qr', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

-- Mantiene carta_publica.codigo_mesa: el código global de cada mesa. SECURITY DEFINER (dueño el migrador,
-- search_path fijo). Toma la empresa de la fila nueva, que la política WITH CHECK ya obligó a ser la del contexto.
CREATE FUNCTION carta_publica.mantener_codigo_mesa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO carta_publica.codigo_mesa (codigo, empresa_id) VALUES (NEW.codigo, NEW.empresa_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
      UPDATE carta_publica.codigo_mesa SET codigo = NEW.codigo
       WHERE codigo = OLD.codigo AND empresa_id = OLD.empresa_id;
    END IF;
    RETURN NEW;
  END IF;
  DELETE FROM carta_publica.codigo_mesa WHERE codigo = OLD.codigo AND empresa_id = OLD.empresa_id;
  RETURN OLD;
END
$fn$;
REVOKE ALL ON FUNCTION carta_publica.mantener_codigo_mesa() FROM PUBLIC;
CREATE TRIGGER mantener_codigo_mesa
  AFTER INSERT OR UPDATE OF codigo OR DELETE ON mesa_qr
  FOR EACH ROW EXECUTE FUNCTION carta_publica.mantener_codigo_mesa();

-- Empresa de una mesa por su código, para las rutas públicas. Coincidencia exacta que distingue mayúsculas, no un
-- LIKE: % y _ no son comodines. Devuelve solo un uuid.
CREATE FUNCTION public.empresa_de_codigo_mesa(p_codigo text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
  SELECT c.empresa_id
    FROM carta_publica.codigo_mesa c
   WHERE c.codigo = p_codigo
$fn$;
REVOKE ALL ON FUNCTION public.empresa_de_codigo_mesa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_de_codigo_mesa(text) TO restaurante_api;
`;

const SQL_DOWN = `
DROP FUNCTION public.empresa_de_codigo_mesa(text);
DROP TRIGGER mantener_codigo_mesa ON mesa_qr;
DROP FUNCTION carta_publica.mantener_codigo_mesa();
DROP TABLE mesa_qr;
DROP TABLE carta_publica.codigo_mesa;
ALTER TABLE mesa DROP CONSTRAINT mesa_id_sucursal_empresa_unico;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
