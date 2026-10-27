/** SQLSTATE de los errores de PostgreSQL que la API traduce a respuestas de negocio. */
export const SQLSTATE = {
  VIOLACION_UNICIDAD: '23505',
  VIOLACION_LLAVE_FORANEA: '23503',
  TEXTO_INVALIDO: '22P02',
  PERMISO_DENEGADO: '42501',
} as const;

interface ErrorPg {
  code?: string;
  constraint?: string;
}

/** El error de `pg` que Sequelize envuelve en `parent` / `original` (o el propio error si es de `pg`). */
function errorPg(error: unknown): ErrorPg | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as { parent?: ErrorPg; original?: ErrorPg } & ErrorPg;
  return e.parent ?? e.original ?? e;
}

/** SQLSTATE del error de PostgreSQL, si lo hay. */
export function sqlstateDe(error: unknown): string | undefined {
  return errorPg(error)?.code;
}

/** Nombre de la restricción violada (unicidad, llave foránea, check), si el error la trae. */
export function restriccionDe(error: unknown): string | undefined {
  return errorPg(error)?.constraint;
}
