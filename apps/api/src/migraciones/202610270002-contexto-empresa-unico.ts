// Historia 001 · fijación única del contexto de empresa (criterio 22e).
//
// Hasta la primera migración, la RLS leía el parámetro `app.empresa_id`, que `restaurante_api` podía
// cambiar con `set_config` (de PUBLIC; quitarlo exige superusuario). Ahora la empresa de la transacción
// vive en `contexto.sesion_empresa`, una tabla en un esquema sin acceso para los roles de la aplicación,
// que solo escriben las dos funciones de abajo (SECURITY DEFINER, dueña `restaurante_migrador`):
//
// - `fijar_contexto_empresa(uuid)` escribe la fila de la sesión (`pid`) para la transacción en curso
//   (`xid8`) y rechaza una segunda fijación en la misma transacción, aunque sea la misma empresa.
// - `empresa_actual()` lee la fila de `(pg_backend_pid(), pg_current_xact_id_if_assigned())`. Ignora
//   `app.empresa_id`, que queda como copia para diagnóstico. Una fila de una transacción anterior tiene
//   otra `xid8` (de 64 bits, no se repite), así que la fijación muere con su transacción.
//
// Todo lo crea el migrador (dueño de la base): no hace falta superusuario. Los nombres de este SQL
// mencionan `fijar_contexto_empresa` y `app.empresa_id`; las migraciones están exentas de la regla de
// ESLint de esos textos.
//
// ATENCIÓN con `down`: deja la RLS leyendo otra vez `app.empresa_id` (con `set_config` de PUBLIC), y
// `ContextoEmpresa` (que ahora llama `fijar_contexto_empresa`) deja de funcionar. Nunca revertir esta
// migración en producción sin revertir también `SQL_FIJAR_CONTEXTO`.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
-- Esquema interno: dueño el migrador, sin acceso para PUBLIC ni para los roles de la aplicación.
CREATE SCHEMA contexto AUTHORIZATION restaurante_migrador;
REVOKE ALL ON SCHEMA contexto FROM PUBLIC;

-- Una fila por sesión de la base (pid); solo vale para la transacción cuya xid guarda. UNLOGGED: no
-- necesita sobrevivir a un reinicio y evita escribir WAL en cada transacción.
CREATE UNLOGGED TABLE contexto.sesion_empresa (
  pid integer PRIMARY KEY,
  xid xid8 NOT NULL,
  empresa_id uuid NOT NULL
);
REVOKE ALL ON TABLE contexto.sesion_empresa FROM PUBLIC;

-- Fija la empresa de la transacción en curso. No es STRICT: con STRICT un NULL devolvería sin ejecutar
-- y no fijaría nada en silencio.
CREATE FUNCTION public.fijar_contexto_empresa(p_empresa uuid) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
BEGIN
  IF p_empresa IS NULL THEN
    RAISE EXCEPTION 'contexto de empresa inválido' USING ERRCODE = '22004';
  END IF;
  INSERT INTO contexto.sesion_empresa AS s (pid, xid, empresa_id)
  VALUES (pg_backend_pid(), pg_current_xact_id(), p_empresa)
  ON CONFLICT (pid) DO UPDATE
    SET xid = EXCLUDED.xid, empresa_id = EXCLUDED.empresa_id
    WHERE s.xid <> EXCLUDED.xid;
  IF NOT FOUND THEN
    -- Ya había una fila de esta misma transacción: no se cambia la empresa.
    RAISE EXCEPTION 'contexto de empresa ya fijado' USING ERRCODE = '42501';
  END IF;
  -- Copia solo para diagnóstico: la RLS no la lee.
  PERFORM set_config('app.empresa_id', p_empresa::text, true);
END
$fn$;
REVOKE ALL ON FUNCTION public.fijar_contexto_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fijar_contexto_empresa(uuid) TO restaurante_api;

-- Empresa de la transacción: la de la fila de esta sesión y esta transacción. Si la transacción no
-- fijó nada, no tiene xid propia (o la fila es de otra xid) y falla con un SQLSTATE fijo. Mantiene las
-- dependencias de las políticas existentes (CREATE OR REPLACE) y su GRANT a restaurante_api.
CREATE OR REPLACE FUNCTION public.empresa_actual() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
DECLARE
  v uuid;
BEGIN
  SELECT s.empresa_id INTO v
    FROM contexto.sesion_empresa s
   WHERE s.pid = pg_backend_pid()
     AND s.xid = pg_current_xact_id_if_assigned();
  IF v IS NULL THEN
    RAISE EXCEPTION 'contexto de empresa ausente' USING ERRCODE = '42501';
  END IF;
  RETURN v;
END
$fn$;
REVOKE ALL ON FUNCTION public.empresa_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_actual() TO restaurante_api;
`;

const SQL_DOWN = `
-- Definición de la primera migración: lee app.empresa_id (SECURITY INVOKER, sin search_path fijo).
CREATE OR REPLACE FUNCTION public.empresa_actual() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY INVOKER
  RESET search_path
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
REVOKE ALL ON FUNCTION public.empresa_actual() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.empresa_actual() TO restaurante_api;

DROP FUNCTION public.fijar_contexto_empresa(uuid);
DROP TABLE contexto.sesion_empresa;
DROP SCHEMA contexto;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
