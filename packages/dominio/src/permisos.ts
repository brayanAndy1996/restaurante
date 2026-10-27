/**
 * Roles, acciones y matriz de permisos (HU-03, RF-12; tabla "Roles y permisos" del documento de
 * diseño). Las funciones de este archivo son parte de la ruta crítica: sus firmas están fijadas. `largoPin`
 * está implementada (tarea T9); la matriz de permisos llega con la tarea T37 (hasta entonces
 * `requisitoPermiso`, `puedeAutorizar`, `alcanceReportes` y `permisosDeRol` lanzan `Error('No implementado')`).
 */

/** Roles de una persona dentro de una sucursal. `ADMINISTRADOR` es de toda la empresa. */
export const ROLES = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'] as const;
export type Rol = (typeof ROLES)[number];

/** Roles que se pueden asignar en `acceso_sucursal` (el Administrador no es un acceso por sucursal). */
export const ROLES_DE_ACCESO = ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'] as const;
export type RolDeAcceso = (typeof ROLES_DE_ACCESO)[number];

/** Códigos de las acciones de la matriz de permisos. */
export const ACCIONES = [
  'ATENDER_MESA',
  'MOVER_UNIR_MESAS',
  'ANULAR_ITEM_ENVIADO',
  'APLICAR_DESCUENTO',
  'APLICAR_CORTESIA',
  'ANULAR_ORDEN',
  'GESTIONAR_PEDIDOS_WEB',
  'COBRAR',
  'EMITIR_NOTA_CREDITO',
  'OPERAR_CAJA',
  'USAR_KDS',
  'GESTIONAR_DISPONIBILIDAD',
  'REGISTRAR_INGRESO_MERCADERIA',
  'AJUSTAR_STOCK',
  'EDITAR_CARTA',
  'ADMINISTRAR',
] as const;
export type Accion = (typeof ACCIONES)[number];

/** Qué exige una acción a un rol: nada (`permitido`), la clave de un supervisor (`clave`) o no se puede. */
export type RequisitoPermiso = 'permitido' | 'clave' | 'prohibido';

/** Hasta dónde llegan los reportes de un rol: su turno (X), su sucursal o toda la empresa. */
export type AlcanceReportes = 'TURNO' | 'SUCURSAL' | 'EMPRESA';

/** Largo del PIN: 4 dígitos (Mozo, Cocina/Barra) o 6 (Cajero, Supervisor, Administrador). */
export type LargoPin = 4 | 6;

const NO_IMPLEMENTADO = 'No implementado';

/** Roles que llevan PIN de 6 dígitos: autorizan acciones o cobran, así que el PIN es más difícil de adivinar. */
const ROLES_CON_PIN_DE_SEIS: ReadonlySet<Rol> = new Set<Rol>([
  'CAJERO',
  'SUPERVISOR',
  'ADMINISTRADOR',
]);

/** Requisito de `accion` para `rol` (criterio 43). */
export function requisitoPermiso(_rol: Rol, _accion: Accion): RequisitoPermiso {
  throw new Error(NO_IMPLEMENTADO);
}

/** `true` si un usuario con `rol` puede autorizar `accion` con su PIN (tiene la acción como `permitido`). */
export function puedeAutorizar(_rol: Rol, _accion: Accion): boolean {
  throw new Error(NO_IMPLEMENTADO);
}

/** Alcance de los reportes del rol, o `null` si no ve reportes (criterio 43). */
export function alcanceReportes(_rol: Rol): AlcanceReportes | null {
  throw new Error(NO_IMPLEMENTADO);
}

/** Requisito de cada acción para el rol (es el campo `permisos` de `GET /sesion`). */
export function permisosDeRol(_rol: Rol): Record<Accion, RequisitoPermiso> {
  throw new Error(NO_IMPLEMENTADO);
}

/**
 * Largo del PIN de un usuario (criterio 21): 6 si es Administrador o tiene `CAJERO` o `SUPERVISOR`
 * en alguna sucursal; 4 si todos sus roles son `MOZO` o `COCINA_BARRA`.
 */
export function largoPin(usuario: { esAdministrador: boolean; roles: readonly Rol[] }): LargoPin {
  if (usuario.esAdministrador) return 6;
  return usuario.roles.some((rol) => ROLES_CON_PIN_DE_SEIS.has(rol)) ? 6 : 4;
}
