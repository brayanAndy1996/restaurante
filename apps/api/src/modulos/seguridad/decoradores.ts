import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import type { Accion, Modulo } from '@restaurante/dominio';
import { SinEmpresa } from '../../nucleo/contexto-empresa';
import { ModuloInterceptor, REQUIERE_MODULO } from './modulo.interceptor';
import { PERMISO, PermisoInterceptor } from './permiso.interceptor';

export { PERMISO, REQUIERE_MODULO };

/**
 * Decoradores de metadatos de las rutas (historia 002). `@Publica`, `@SoloAdministrador`,
 * `@RequiereSucursal` y `@PermiteContrasenaTemporal` los lee el guard global de autenticación
 * (`AutenticacionGuard`); `@Permiso` y `@RequiereModulo` los leen sus interceptores (`PermisoInterceptor` y
 * `ModuloInterceptor`, que se aplican con el propio decorador). `@Idempotente()` vive en `nucleo/idempotencia` y se reexporta
 * desde el índice de este módulo. `@Superadministrador()` vive en `modulos/plataforma`.
 */

export const PUBLICA = 'publica';
export const SOLO_ADMINISTRADOR = 'solo-administrador';
export const REQUIERE_SUCURSAL = 'requiere-sucursal';
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
 * `clave` → exige `X-Autorizacion` y consume la autorización en la misma transacción de la acción.
 * La aplica el `PermisoInterceptor`.
 */
export const Permiso = (accion: Accion) =>
  applyDecorators(SetMetadata(PERMISO, accion), UseInterceptors(PermisoInterceptor));

/**
 * Ruta de un módulo del plan: 403 `MODULO_NO_INCLUIDO` si la sucursal activa no lo tiene (criterio 77).
 * Implica `@RequiereSucursal()` (sin sucursal activa no hay plan que mirar) y aplica `ModuloInterceptor`,
 * que lee el plan vigente dentro de la transacción de empresa del controlador.
 */
export const RequiereModulo = (modulo: Modulo) =>
  applyDecorators(
    SetMetadata(REQUIERE_MODULO, modulo),
    SetMetadata(REQUIERE_SUCURSAL, true),
    UseInterceptors(ModuloInterceptor),
  );
