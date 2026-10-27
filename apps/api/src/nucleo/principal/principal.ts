import type { Rol } from '@restaurante/dominio';

/** Tipo de sesión de empresa; `PRUEBA` es el principal del modo de prueba (solo `NODE_ENV=test`). */
export type TipoPrincipal = 'CONTRASENA' | 'PIN' | 'SOPORTE' | 'PRUEBA';

/**
 * Quién hace la petición, calculado por la API en cada petición (no lo envía el cliente). Lo lee el
 * código dentro de una petición con `SesionActual.principal()`.
 */
export interface Principal {
  tipo: TipoPrincipal;
  empresaId: string;
  /** `null` en el principal de prueba (no hay sesión guardada). */
  sesionId: string | null;
  /** `null` en soporte y en el principal de prueba. */
  usuarioId: string | null;
  /** Solo en soporte. */
  superadministradorId: string | null;
  /** Sucursal activa; `null` mientras la persona no la elige. */
  sucursalId: string | null;
  /** Rol en la sucursal activa; `ADMINISTRADOR` en soporte y prueba; `null` si todavía no hay sucursal. */
  rol: Rol | null;
  esAdministrador: boolean;
  /** Equipo y equipo recordado de la sesión (en sesiones PIN y de contraseña ya recordadas). */
  equipoId: string | null;
  equipoRecordadoId: string | null;
}
