import { SetMetadata, applyDecorators } from '@nestjs/common';
import type { Accion, Modulo } from '@restaurante/dominio';
import { SinEmpresa } from '../../nucleo/contexto-empresa';

/**
 * Decoradores de metadatos de las rutas (historia 002). Hasta las tareas de la fase C solo dejan la
 * marca: el guard global de autenticación y los interceptores que las leen todavía no se registran.
 * `@Idempotente()` vive en `nucleo/idempotencia` y se reexporta desde el índice de este módulo.
 * `@Superadministrador()` vive en `modulos/plataforma`.
 */

export const PUBLICA = 'publica';
export const SOLO_ADMINISTRADOR = 'solo-administrador';
export const REQUIERE_SUCURSAL = 'requiere-sucursal';
export const PERMISO = 'permiso';
export const REQUIERE_MODULO = 'requiere-modulo';

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
 * Acción protegida de la matriz de permisos (criterio 48): `prohibido` → 403, `permitido` → sigue,
 * `clave` → exige `X-Autorizacion`. La aplica el `PermisoInterceptor` (tarea T38).
 */
export const Permiso = (accion: Accion) => SetMetadata(PERMISO, accion);

/** Ruta de un módulo del plan: 403 `MODULO_NO_INCLUIDO` si la sucursal activa no lo tiene (criterio 77). */
export const RequiereModulo = (modulo: Modulo) => SetMetadata(REQUIERE_MODULO, modulo);
