// Historia 006 · caja, cobro y comprobantes, entrega 6b, grupo C8 (criterios 138, 139, 142 y 164, plan "Migraciones" 12):
// el padrón reducido de RUC de SUNAT y el catálogo de ubigeo. Dueño: facturación.
//
// - Esquema `referencia`: dueño el migrador, sin acceso para PUBLIC ni para `restaurante_api` ni
//   `restaurante_plataforma`. Solo `restaurante_referencia` (el rol de `DATABASE_REFERENCIA_URL`, que crea `db:preparar`: los
//   roles no se crean en migraciones) tiene `USAGE`.
// - `padron_ruc_a` y `padron_ruc_b`: dos tablas alternas con el padrón (la carga llena la inactiva con `COPY` y luego cambia
//   `padron_estado.tabla_activa`, así las búsquedas nunca ven una carga a medias). Solo las columnas que se usan. Sin
//   `empresa_id` ni trazabilidad: es información pública de SUNAT, igual para todas las empresas, y nada de lo que escriben los
//   cajeros llega aquí (criterio 142).
// - `padron_estado`: una sola fila (índice único sobre una constante); la migración no la llena, la primera carga la crea
//   con `INSERT … ON CONFLICT`.
// - `ubigeo`: catálogo del INEI (`datos/ubigeo.csv`), con la `version` del archivo que lo cargó.
// - RLS activada con una sola política, `carga_padron` (`FOR ALL TO restaurante_referencia`), y ninguna para los demás roles
//   (defensa en profundidad: el dueño, que ejecuta la función, la usa igual porque no es `FORCE`).
// - `public.padron_buscar_ruc(text)`: `SECURITY DEFINER`, `STABLE`, `search_path` fijo, `EXECUTE` solo para `restaurante_api`.
//   Devuelve a lo más la fila de ese RUC exacto de 11 dígitos de la tabla activa; un patrón, un texto vacío o 10 dígitos no
//   devuelven nada. Sin ninguna carga todavía falla con el estado `RF503` (el servicio lo responde 503
//   `PADRON_NO_DISPONIBLE`). No escribe nada ni guarda quién consultó qué.
//
// - `public.padron_estado()`: el estado de la carga (cinco columnas, ningún dato del padrón) para `GET /plataforma/padron`;
//   `SECURITY DEFINER`, `STABLE`, `EXECUTE` solo para `restaurante_plataforma`.
//
// `restaurante_referencia`: `SELECT`, `INSERT` y `TRUNCATE` en las tres tablas de datos (nunca `UPDATE` ni `DELETE`: la carga
// vacía con `TRUNCATE`) y `SELECT`, `INSERT` y `UPDATE` en `padron_estado`. Las migraciones están exentas de la regla de
// ESLint de los nombres de funciones del contexto. Ninguna migración escribe datos.
import type { ContextoMigracion } from './tipos';

const TABLA_DEL_PADRON = (nombre: string): string => `
CREATE TABLE referencia.${nombre} (
  ruc char(11) PRIMARY KEY,
  razon_social text NOT NULL,
  estado text NOT NULL,
  condicion text NOT NULL,
  ubigeo char(6),
  direccion text
);
ALTER TABLE referencia.${nombre} ENABLE ROW LEVEL SECURITY;
CREATE POLICY carga_padron ON referencia.${nombre} AS PERMISSIVE FOR ALL TO restaurante_referencia
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE referencia.${nombre} FROM PUBLIC;
GRANT SELECT, INSERT, TRUNCATE ON TABLE referencia.${nombre} TO restaurante_referencia;
`;

const SQL_UP = `
CREATE SCHEMA referencia AUTHORIZATION restaurante_migrador;
REVOKE ALL ON SCHEMA referencia FROM PUBLIC;
GRANT USAGE ON SCHEMA referencia TO restaurante_referencia;
${TABLA_DEL_PADRON('padron_ruc_a')}
${TABLA_DEL_PADRON('padron_ruc_b')}

CREATE TABLE referencia.padron_estado (
  tabla_activa char(1) CHECK (tabla_activa IN ('a', 'b')),
  cargado_en timestamptz,
  filas integer CHECK (filas >= 0),
  fecha_archivo date,
  ultimo_intento_en timestamptz,
  ultimo_error text
);
-- Una sola fila: un índice único sobre una constante.
CREATE UNIQUE INDEX padron_estado_una_fila ON referencia.padron_estado ((true));
ALTER TABLE referencia.padron_estado ENABLE ROW LEVEL SECURITY;
CREATE POLICY carga_padron ON referencia.padron_estado AS PERMISSIVE FOR ALL TO restaurante_referencia
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE referencia.padron_estado FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE referencia.padron_estado TO restaurante_referencia;

CREATE TABLE referencia.ubigeo (
  codigo char(6) PRIMARY KEY,
  departamento text NOT NULL,
  provincia text NOT NULL,
  distrito text NOT NULL,
  version text NOT NULL
);
ALTER TABLE referencia.ubigeo ENABLE ROW LEVEL SECURITY;
CREATE POLICY carga_padron ON referencia.ubigeo AS PERMISSIVE FOR ALL TO restaurante_referencia
  USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE referencia.ubigeo FROM PUBLIC;
GRANT SELECT, INSERT, TRUNCATE ON TABLE referencia.ubigeo TO restaurante_referencia;

-- La búsqueda de la API: solo por un RUC exacto de 11 dígitos (coincidencia por igualdad, nunca LIKE: % y _ no son
-- comodines), en la tabla activa. Sin ninguna carga, el estado RF503.
CREATE FUNCTION public.padron_buscar_ruc(p_ruc text)
  RETURNS TABLE (ruc text, razon_social text, estado text, condicion text, ubigeo text, direccion text, cargado_en timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
#variable_conflict use_column
DECLARE
  v_activa char(1);
  v_cargado timestamptz;
BEGIN
  SELECT e.tabla_activa, e.cargado_en INTO v_activa, v_cargado FROM referencia.padron_estado e;
  IF v_activa IS NULL THEN
    RAISE EXCEPTION 'El padrón de RUC todavía no se ha cargado' USING ERRCODE = 'RF503';
  END IF;
  IF p_ruc IS NULL OR p_ruc !~ '^[0-9]{11}$' THEN
    RETURN;
  END IF;
  IF v_activa = 'a' THEN
    RETURN QUERY
      SELECT t.ruc::text, t.razon_social, t.estado, t.condicion, t.ubigeo::text, t.direccion, v_cargado
        FROM referencia.padron_ruc_a t
       WHERE t.ruc = p_ruc::char(11);
  ELSE
    RETURN QUERY
      SELECT t.ruc::text, t.razon_social, t.estado, t.condicion, t.ubigeo::text, t.direccion, v_cargado
        FROM referencia.padron_ruc_b t
       WHERE t.ruc = p_ruc::char(11);
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.padron_buscar_ruc(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.padron_buscar_ruc(text) TO restaurante_api;

-- El estado de la carga para GET /plataforma/padron: restaurante_plataforma no tiene USAGE en el esquema, así que lo lee
-- por esta función (solo las cinco columnas del estado, ningún dato del padrón).
CREATE FUNCTION public.padron_estado()
  RETURNS TABLE (cargado_en timestamptz, filas integer, fecha_archivo date, ultimo_intento_en timestamptz, ultimo_error text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
  SELECT e.cargado_en, e.filas, e.fecha_archivo, e.ultimo_intento_en, e.ultimo_error FROM referencia.padron_estado e
$fn$;
REVOKE ALL ON FUNCTION public.padron_estado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.padron_estado() TO restaurante_plataforma;
`;

const SQL_DOWN = `
DROP FUNCTION public.padron_estado();
DROP FUNCTION public.padron_buscar_ruc(text);
DROP TABLE referencia.ubigeo;
DROP TABLE referencia.padron_estado;
DROP TABLE referencia.padron_ruc_b;
DROP TABLE referencia.padron_ruc_a;
DROP SCHEMA referencia;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
