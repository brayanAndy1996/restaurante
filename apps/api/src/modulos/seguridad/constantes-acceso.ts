/**
 * Constantes del ingreso con PIN y de los equipos recordados (historia 002, grupo C2). Las reglas de
 * tiempo se evalúan con el reloj de la API; aquí solo están los valores.
 */

/** Minutos de inactividad de una sesión PIN cuando la sucursal activa no los configuró (criterios 39 y 40). */
export const MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO = 5;
/** Duración máxima de una sesión PIN desde que se creó (criterio 39). */
export const HORAS_MAXIMAS_PIN = 12;

/** Cada cuántos fallos seguidos de PIN de una persona en un equipo se bloquea (5.º y 10.º, criterio 36). */
export const FALLOS_PARA_BLOQUEAR_PIN = 5;
/** Fallos seguidos con los que el equipo deja de recordar a la persona (15.º, criterio 36). */
export const FALLOS_PARA_OLVIDAR_PIN = 15;
/** Duración de cada bloqueo de PIN, en minutos (criterio 36). */
export const MINUTOS_BLOQUEO_PIN = 5;

/** Por qué un equipo deja de recordar a una persona (columna `equipo_recordado.motivo_revocacion`). */
export type MotivoRevocacion =
  'REVOCADO' | 'OLVIDADO' | 'REEMPLAZADO' | 'BLOQUEO' | 'DESACTIVADO' | 'CONTRASENA_RESTABLECIDA';

/** Minutos que vale una autorización de supervisor desde que se crea (criterio 44). */
export const MINUTOS_VIGENCIA_AUTORIZACION = 2;
/** Fallos seguidos de clave de supervisor (por solicitante o por equipo) que bloquean (criterio 47). */
export const FALLOS_PARA_BLOQUEAR_CLAVE = 5;
/** Duración del bloqueo de la clave de supervisor, en minutos (criterio 47). */
export const MINUTOS_BLOQUEO_CLAVE = 5;
