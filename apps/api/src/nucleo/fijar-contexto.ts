/**
 * Texto con el que `ContextoEmpresa` fija la empresa de la transacción (criterio 22e). Es un archivo
 * sin dependencias de Nest para que la guarda de consultas (`base-de-datos/`) lo lea sin importar el
 * servicio de contexto, y no se importa fuera de `src/nucleo/` (regla de ESLint, criterio 22c).
 *
 * Junto con el servicio de contexto, es el único archivo de la API autorizado a escribir
 * `fijar_contexto_empresa` (regla de ESLint, criterios 37 y 22e); las migraciones también, por su SQL.
 * Es además el único autorizado a escribir `fijar_contexto_actor` y `empresa_de_usuario` (historia 002).
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

/**
 * Nombre de la función de la base que fija el actor de la transacción (historia 002, criterios 113 a
 * 120). Mismo trato que `fijar_contexto_empresa`: solo este archivo y las migraciones lo escriben (regla
 * de ESLint), y la guarda de consultas rechaza toda otra mención.
 */
export const NOMBRE_FUNCION_FIJAR_ACTOR = 'fijar_contexto_actor';

/**
 * Sentencia que fija el actor de la transacción: `(usuario, equipo, superadministrador, sistema)`, con
 * exactamente un actor y el equipo solo junto con un usuario. La guarda de la API reconoce este texto
 * exacto, pero solo lo deja pasar si `ContextoEmpresa` lo registró antes como pendiente; la de
 * plataforma ni siquiera lo recibe por la guarda (lo manda `ConexionPlataforma.fijarActor`). La base
 * garantiza que el actor se fija una sola vez por transacción: una segunda llamada falla con `42501`.
 */
export const SQL_FIJAR_ACTOR = `SELECT ${NOMBRE_FUNCION_FIJAR_ACTOR}($1, $2, $3, $4)`;

/**
 * Nombre de la función de la base que busca la empresa de un usuario por su nombre al ingresar (criterio
 * 89). Solo `consultas-sin-empresa.ts`, este archivo y las migraciones lo escriben; dentro de un
 * contexto de empresa la guarda rechaza su mención.
 */
export const NOMBRE_FUNCION_EMPRESA_DE_USUARIO = 'empresa_de_usuario';
