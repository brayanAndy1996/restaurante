// Historia 006 · caja, cobro y comprobantes, entrega 6b, grupo C8 (criterio 139): la fecha de la carga activa del padrón para
// el 404 `RUC_NO_ENCONTRADO` («no figura en el padrón de SUNAT del 05/11», criterio 140). `padron_buscar_ruc` devuelve a lo más
// una fila y ninguna cuando el RUC no está, así que sin esta función la API no podría decir de qué carga habla.
//
// - `public.padron_cargado_en()`: `SECURITY DEFINER`, `STABLE`, `search_path` fijo, dueño el migrador y `EXECUTE` solo para
//   `restaurante_api`. Devuelve únicamente el instante de la carga activa (`NULL` sin ninguna carga); ningún dato del padrón
//   ni de quién consultó. Es el mismo valor para todas las empresas.
// Ninguna migración escribe datos.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
CREATE FUNCTION public.padron_cargado_en()
  RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
  SELECT e.cargado_en FROM referencia.padron_estado e WHERE e.tabla_activa IS NOT NULL
$fn$;
REVOKE ALL ON FUNCTION public.padron_cargado_en() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.padron_cargado_en() TO restaurante_api;
`;

const SQL_DOWN = `
DROP FUNCTION public.padron_cargado_en();
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
