/**
 * Texto con el que `ContextoEmpresa` fija la empresa de la transacción (criterio 22e). Es un archivo
 * sin dependencias de Nest para que la guarda de consultas (`base-de-datos/`) lo lea sin importar el
 * servicio de contexto, y no se importa fuera de `src/nucleo/` (regla de ESLint, criterio 22c).
 *
 * Junto con el servicio de contexto, es el único archivo de la API autorizado a escribir
 * `fijar_contexto_empresa` (regla de ESLint, criterios 37 y 22e); las migraciones también, por su SQL.
 */

/**
 * Nombre de la función de la base que fija la empresa de la transacción. La guarda de consultas lo
 * lee de aquí para rechazar toda otra mención, porque el lint prohíbe escribir el texto fuera de este
 * archivo y de las migraciones.
 */
export const NOMBRE_FUNCION_FIJAR_CONTEXTO = 'fijar_contexto_empresa';

/**
 * Sentencia que fija la empresa de la transacción. La guarda de consultas
 * (`base-de-datos/guarda-api.ts`) reconoce este texto exacto, pero solo autoriza la transacción si
 * `ContextoEmpresa.ejecutar` la registró antes como pendiente. La base (no la guarda) garantiza que
 * la empresa se fija una sola vez por transacción: una segunda llamada falla con `42501`.
 */
export const SQL_FIJAR_CONTEXTO = `SELECT ${NOMBRE_FUNCION_FIJAR_CONTEXTO}($1)`;
