/**
 * Consultas que pueden correr sin contexto de empresa: la verificación de salud y la verificación
 * de roles al arrancar. Se marcan con la opción `{ sinEmpresa: 'salud' | 'verificacion-roles' }`.
 *
 * La marca no es un permiso general: cada motivo solo acepta un texto SQL exacto (definido aquí), sin
 * parámetros, sin transacción y fuera de cualquier contexto de empresa u operación de plataforma.
 * Marcar otra consulta con `sinEmpresa` la hace fallar igual que si no tuviera contexto. Las dos
 * consultas leen solo el catálogo de PostgreSQL o devuelven una constante, así que aunque alguien
 * las ejecute no obtienen datos de ninguna empresa.
 */
import type { QueryOptions } from 'sequelize';
import { estadoActual } from './estado-operacion';

export type MotivoSinEmpresa = 'salud' | 'verificacion-roles';

export const SQL_SALUD = 'SELECT 1 AS ok';

/**
 * Atributos del rol de la conexión, tablas de `public` que posee y roles privilegiados de los que es
 * miembro (criterio 10b). La membresía se recorre de forma recursiva por `pg_auth_members` y cuenta
 * con `INHERIT` o `NOINHERIT` (con `NOINHERIT` basta un `SET ROLE`). Un rol es privilegiado si es
 * `restaurante_migrador`, superusuario, tiene `BYPASSRLS` o es dueño de alguna tabla de `public`.
 */
export const SQL_VERIFICACION_ROLES = `WITH RECURSIVE
  conexion AS (SELECT oid, rolname FROM pg_roles WHERE rolname = current_user),
  pertenencia (oid, ruta) AS (
    SELECT m.roleid, ARRAY[m.roleid]
      FROM pg_auth_members m
      JOIN conexion c ON c.oid = m.member
    UNION ALL
    SELECT m.roleid, p.ruta || m.roleid
      FROM pg_auth_members m
      JOIN pertenencia p ON p.oid = m.member
     WHERE NOT m.roleid = ANY (p.ruta)
  )
SELECT r.rolname AS rol,
       r.rolsuper AS superusuario,
       r.rolbypassrls AS bypassrls,
       COALESCE((SELECT array_agg(c.relname::text ORDER BY c.relname)
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public'
                    AND c.relowner = r.oid
                    AND c.relkind IN ('r', 'p', 'v', 'm')), ARRAY[]::text[]) AS tablas_propias,
       COALESCE((SELECT json_agg(json_build_object(
                          'rol', g.rolname,
                          'via', (SELECT string_agg(v.rolname::text, ' > ' ORDER BY u.n)
                                    FROM unnest(p.ruta) WITH ORDINALITY AS u(oid, n)
                                    JOIN pg_roles v ON v.oid = u.oid),
                          'migrador', g.rolname = 'restaurante_migrador',
                          'superusuario', g.rolsuper,
                          'bypassrls', g.rolbypassrls,
                          'tablas_propias', COALESCE((SELECT array_agg(c.relname::text ORDER BY c.relname)
                                                        FROM pg_class c
                                                        JOIN pg_namespace n ON n.oid = c.relnamespace
                                                       WHERE n.nspname = 'public'
                                                         AND c.relowner = g.oid
                                                         AND c.relkind IN ('r', 'p', 'v', 'm')),
                                                     ARRAY[]::text[])
                        ) ORDER BY g.rolname)
                   FROM pertenencia p
                   JOIN pg_roles g ON g.oid = p.oid
                  WHERE g.rolname = 'restaurante_migrador'
                     OR g.rolsuper
                     OR g.rolbypassrls
                     OR EXISTS (SELECT 1
                                  FROM pg_class c
                                  JOIN pg_namespace n ON n.oid = c.relnamespace
                                 WHERE n.nspname = 'public'
                                   AND c.relowner = g.oid
                                   AND c.relkind IN ('r', 'p', 'v', 'm'))), '[]'::json) AS membresias
  FROM pg_roles r
  JOIN conexion c ON c.oid = r.oid`;

const SQL_POR_MOTIVO: Record<MotivoSinEmpresa, string> = {
  salud: SQL_SALUD,
  'verificacion-roles': SQL_VERIFICACION_ROLES,
};

/** Opciones de una consulta marcada como excepción. */
export interface OpcionesSinEmpresa extends QueryOptions {
  sinEmpresa?: MotivoSinEmpresa;
}

/**
 * `true` si la consulta marcada `sinEmpresa` cumple todas las condiciones de su motivo. `motivos`
 * limita qué motivos acepta la conexión (la de plataforma solo acepta `verificacion-roles`).
 */
export function esConsultaSinEmpresaValida(
  texto: string | undefined,
  opciones: OpcionesSinEmpresa,
  motivos: readonly MotivoSinEmpresa[],
): boolean {
  const motivo = opciones.sinEmpresa;
  if (motivo === undefined || !motivos.includes(motivo)) return false;
  const esperado = SQL_POR_MOTIVO[motivo];
  if (esperado === undefined || texto === undefined || texto.trim() !== esperado) return false;
  if (opciones.transaction !== undefined && opciones.transaction !== null) return false;
  if (opciones.bind !== undefined || opciones.replacements !== undefined) return false;
  // Ni dentro de un contexto de empresa ni de una operación de plataforma.
  return estadoActual() === undefined;
}

/** Texto SQL de una consulta de Sequelize (cadena u objeto `{ query }`). */
export function textoDeConsulta(sql: unknown): string | undefined {
  if (typeof sql === 'string') return sql.trim();
  if (sql !== null && typeof sql === 'object' && 'query' in sql) {
    const query = (sql as { query: unknown }).query;
    if (typeof query === 'string') return query.trim();
  }
  return undefined;
}

/**
 * Sentencias de control de transacción que genera Sequelize (`START TRANSACTION`, `COMMIT`,
 * `ROLLBACK` y `SET TRANSACTION ISOLATION LEVEL …`). No leen ni escriben datos, así que no
 * necesitan contexto; abrir y cerrar la transacción pasa por `sequelize.query` como cualquier otra.
 */
export function esControlDeTransaccion(texto: string | undefined): boolean {
  if (texto === undefined) return false;
  return /^(START TRANSACTION|COMMIT|ROLLBACK|SET TRANSACTION ISOLATION LEVEL (READ COMMITTED|READ UNCOMMITTED|REPEATABLE READ|SERIALIZABLE));?$/i.test(
    texto,
  );
}
