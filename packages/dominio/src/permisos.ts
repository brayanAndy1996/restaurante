/**
 * Roles, acciones y matriz de permisos (HU-03, RF-12; tabla "Roles y permisos" del documento de
 * diseño). Las funciones de este archivo son parte de la ruta crítica: sus firmas están fijadas. Son reglas
 * puras: las usan la API y la PWA.
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

/** Roles que llevan PIN de 6 dígitos: autorizan acciones o cobran, así que el PIN es más difícil de adivinar. */
const ROLES_CON_PIN_DE_SEIS: ReadonlySet<Rol> = new Set<Rol>([
  'CAJERO',
  'SUPERVISOR',
  'ADMINISTRADOR',
]);

const P = 'permitido';
const C = 'clave';
const X = 'prohibido';

/**
 * Matriz de permisos, celda por celda como la tabla "Roles y permisos" del documento de diseño (criterio 43).
 * Orden de las columnas: Mozo, Cajero, Cocina/Barra, Supervisor, Administrador.
 */
const MATRIZ: Readonly<Record<Accion, readonly [...RequisitoPermiso[]]>> = {
  ATENDER_MESA: [P, P, X, P, P],
  MOVER_UNIR_MESAS: [P, P, X, P, P],
  ANULAR_ITEM_ENVIADO: [C, C, X, P, P],
  APLICAR_DESCUENTO: [C, C, X, P, P],
  APLICAR_CORTESIA: [C, C, X, P, P],
  ANULAR_ORDEN: [C, C, X, P, P],
  GESTIONAR_PEDIDOS_WEB: [X, P, X, P, P],
  COBRAR: [X, P, X, P, P],
  EMITIR_NOTA_CREDITO: [X, C, X, P, P],
  OPERAR_CAJA: [X, P, X, P, P],
  USAR_KDS: [X, X, P, P, P],
  GESTIONAR_DISPONIBILIDAD: [X, X, P, P, P],
  REGISTRAR_INGRESO_MERCADERIA: [X, P, X, P, P],
  AJUSTAR_STOCK: [X, X, X, P, P],
  EDITAR_CARTA: [X, P, X, X, P],
  ADMINISTRAR: [X, X, X, X, P],
};

/** Posición de cada rol en las filas de `MATRIZ`. */
const COLUMNA_DEL_ROL: Readonly<Record<Rol, number>> = {
  MOZO: 0,
  CAJERO: 1,
  COCINA_BARRA: 2,
  SUPERVISOR: 3,
  ADMINISTRADOR: 4,
};

/** Alcance de los reportes de cada rol (`null`: no ve reportes). */
const ALCANCE_DE_REPORTES: Readonly<Record<Rol, AlcanceReportes | null>> = {
  MOZO: null,
  CAJERO: 'TURNO',
  COCINA_BARRA: null,
  SUPERVISOR: 'SUCURSAL',
  ADMINISTRADOR: 'EMPRESA',
};

/** Requisito de `accion` para `rol` (criterio 43). */
export function requisitoPermiso(rol: Rol, accion: Accion): RequisitoPermiso {
  return MATRIZ[accion][COLUMNA_DEL_ROL[rol]] as RequisitoPermiso;
}

/** `true` si un usuario con `rol` puede autorizar `accion` con su PIN (tiene la acción como `permitido`). */
export function puedeAutorizar(rol: Rol, accion: Accion): boolean {
  return requisitoPermiso(rol, accion) === 'permitido';
}

/** Alcance de los reportes del rol, o `null` si no ve reportes (criterio 43). */
export function alcanceReportes(rol: Rol): AlcanceReportes | null {
  return ALCANCE_DE_REPORTES[rol];
}

/** Requisito de cada acción para el rol (es el campo `permisos` de `GET /sesion`). */
export function permisosDeRol(rol: Rol): Record<Accion, RequisitoPermiso> {
  return Object.fromEntries(
    ACCIONES.map((accion) => [accion, requisitoPermiso(rol, accion)]),
  ) as Record<Accion, RequisitoPermiso>;
}

/**
 * Largo del PIN de un usuario (criterio 21): 6 si es Administrador o tiene `CAJERO` o `SUPERVISOR`
 * en alguna sucursal; 4 si todos sus roles son `MOZO` o `COCINA_BARRA`.
 */
export function largoPin(usuario: { esAdministrador: boolean; roles: readonly Rol[] }): LargoPin {
  if (usuario.esAdministrador) return 6;
  return usuario.roles.some((rol) => ROLES_CON_PIN_DE_SEIS.has(rol)) ? 6 : 4;
}
