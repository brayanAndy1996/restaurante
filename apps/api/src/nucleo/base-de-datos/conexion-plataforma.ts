/**
 * Conexión de plataforma (`restaurante_plataforma`, `DATABASE_PLATAFORMA_URL`).
 *
 * Solo `PlataformaModule` (src/modulos/plataforma/) puede importar este archivo; desde la tarea
 * T16 una regla de ESLint (`no-restricted-imports`) lo exige (criterio 37).
 *
 * FASE A: solo el token del proveedor; la instancia de Sequelize llega en la tarea T11.
 */
export const CONEXION_PLATAFORMA = Symbol('CONEXION_PLATAFORMA');
