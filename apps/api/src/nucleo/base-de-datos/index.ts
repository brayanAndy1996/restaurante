/**
 * API pública de `nucleo/base-de-datos`.
 *
 * - `CONEXION_API`: token de Nest de la instancia de Sequelize de la API (`restaurante_api`). Toda
 *   consulta por ella, incluidas las crudas (`sequelize.query`), exige un contexto de empresa
 *   (`ContextoEmpresa.ejecutar`); sin él lanza `ContextoEmpresaAusenteError` antes de tocar la base.
 *   Ver `apps/api/test/README.md`.
 * - La conexión de plataforma NO se exporta aquí (ver `conexion-plataforma.ts`).
 */
export { CONEXION_API } from './token-api';
export { BaseDeDatosModule } from './base-de-datos.module';
export { ConsultaProhibidaError, RolPrivilegiadoError } from './errores';
export { SQLSTATE, restriccionDe, sqlstateDe } from './errores-pg';
export { TIEMPO_LIMITE_SALUD_MS, comprobarConexion } from './salud';
export { verificarRolDeConexion } from './verificar-roles';
export type { MotivoSinEmpresa } from './consultas-sin-empresa';
export { ejecutarConEstado, estadoActual, type EstadoOperacion } from './estado-operacion';
