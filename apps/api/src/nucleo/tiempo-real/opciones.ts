/** Token de Nest con las opciones del tiempo real (`crearAplicacion({ tiempoReal })`). */
export const OPCIONES_TIEMPO_REAL = Symbol('OPCIONES_TIEMPO_REAL');

/** Ruta del servidor de Socket.IO (criterio 64 de la historia 004). */
export const RUTA_TIEMPO_REAL = '/tiempo-real';

export interface OpcionesTiempoReal {
  /** Si la API sirve Socket.IO. Por defecto lo decide `TIEMPO_REAL` del entorno. */
  habilitado: boolean;
}
