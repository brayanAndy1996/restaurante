// Historia 002 · soporte de un superadministrador desactivado (criterios 61, 62 y 66 a 68).
//
// El guard de las sesiones de empresa debe comprobar en cada petición de soporte que el superadministrador
// sigue activo: así una sesión de soporte creada justo después de desactivarlo (la desactivación ganó la
// carrera contra el INSERT de la sesión y por eso no la cerró) deja de valer en la siguiente petición.
//
// `restaurante_api` no tiene ningún privilegio sobre `superadministrador` (criterio 88) y no se le da. En su
// lugar, `public.superadministrador_activo(uuid)` (`SECURITY DEFINER`, dueño el migrador, `search_path`
// fijo, `EXECUTE` solo para la API) responde únicamente si ese id es de un superadministrador activo:
// un `boolean`, sin más datos. Como la tabla tiene la RLS forzada y su única política es la de plataforma,
// el dueño necesita una política propia de solo lectura para que la función vea la fila; no alcanza a
// nadie más (`TO restaurante_migrador`, solo `SELECT`, y el migrador no es un rol de conexión de la aplicación).
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
CREATE POLICY lectura_activo_migrador ON superadministrador AS PERMISSIVE FOR SELECT
  TO restaurante_migrador USING (true);

CREATE FUNCTION public.superadministrador_activo(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.superadministrador s WHERE s.id = p_id AND s.activo)
$fn$;
REVOKE ALL ON FUNCTION public.superadministrador_activo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadministrador_activo(uuid) TO restaurante_api;
`;

const SQL_DOWN = `
DROP FUNCTION public.superadministrador_activo(uuid);
DROP POLICY lectura_activo_migrador ON superadministrador;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
