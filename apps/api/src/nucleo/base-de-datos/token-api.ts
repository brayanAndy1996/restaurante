/**
 * Token de Nest de la conexión de la API: la instancia de Sequelize de `restaurante_api`
 * (`DATABASE_URL`). Es el único acceso de la API a la base; todas sus consultas pasan por la guarda
 * de `guarda-api.ts`. Archivo sin dependencias para evitar ciclos de importación.
 */
export const CONEXION_API = Symbol('CONEXION_API');
