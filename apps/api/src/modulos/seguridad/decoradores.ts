import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { Accion, Modulo } from '@restaurante/dominio';
import { SinEmpresa } from '../../nucleo/contexto-empresa';

/**
 * Decoradores de metadatos de las rutas (historia 002). `@Publica`, `@SoloAdministrador`,
 * `@RequiereSucursal` y `@PermiteContrasenaTemporal` los lee el guard global de autenticación
 * (`AutenticacionGuard`); `@Permiso` y `@RequiereModulo` los leerán sus interceptores (tareas T38 y T29,
 * hasta entonces solo dejan la marca). `@Idempotente()` vive en `nucleo/idempotencia` y se reexporta
 * desde el índice de este módulo. `@Superadministrador()` vive en `modulos/plataforma`.
 */

export const PUBLICA = 'publica';
export const SOLO_ADMINISTRADOR = 'solo-administrador';
export const REQUIERE_SUCURSAL = 'requiere-sucursal';
export const PERMISO = 'permiso';
export const REQUIERE_MODULO = 'requiere-modulo';
export const PERMITE_CONTRASENA_TEMPORAL = 'permite-contrasena-temporal';

/**
 * Ruta pública: pasa sin sesión (lista cerrada en el criterio 1). Implica `@SinEmpresa()`: sin
 * sesión no hay empresa. Toda ruta sin este decorador exige sesión.
 */
export const Publica = () => applyDecorators(SetMetadata(PUBLICA, true), SinEmpresa());

/** Ruta solo para el Administrador (y las sesiones de soporte y de prueba, que lo son). */
export const SoloAdministrador = () => SetMetadata(SOLO_ADMINISTRADOR, true);

/** Ruta que necesita sucursal activa: sin ella responde 409 `SUCURSAL_NO_ELEGIDA`. */
export const RequiereSucursal = () => SetMetadata(REQUIERE_SUCURSAL, true);

/**
 * Ruta que una sesión con contraseña temporal sí puede usar (criterio 15): `GET /sesion`,
 * `PUT /sesion/contrasena` y `DELETE /sesion`. Toda otra ruta autenticada responde 403
 * `CAMBIO_CONTRASENA_REQUERIDO` hasta que la persona cambia su contraseña.
 */
export const PermiteContrasenaTemporal = () => SetMetadata(PERMITE_CONTRASENA_TEMPORAL, true);

/**
 * Acción protegida de la matriz de permisos (criterio 48): `prohibido` → 403, `permitido` → sigue,
 * `clave` → exige `X-Autorizacion`. La aplica el `PermisoInterceptor` (tarea T38).
 */
export const Permiso = (accion: Accion) => SetMetadata(PERMISO, accion);

/** Ruta de un módulo del plan: 403 `MODULO_NO_INCLUIDO` si la sucursal activa no lo tiene (criterio 77). */
export const RequiereModulo = (modulo: Modulo) => SetMetadata(REQUIERE_MODULO, modulo);
