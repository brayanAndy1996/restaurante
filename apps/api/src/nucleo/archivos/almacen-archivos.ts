/**
 * Puerto del almacén de archivos (historia 003, decisión 1): las fotos de la carta. Implementaciones:
 * `AlmacenEnMemoria` (pruebas), `AlmacenEnDisco` (desarrollo) y `AlmacenR2` (producción).
 */

/** Token de Nest del almacén de archivos. */
export const ALMACEN_ARCHIVOS = Symbol('ALMACEN_ARCHIVOS');

export interface AlmacenArchivos {
  /** Guarda `contenido` bajo `clave` con su `Content-Type`; si la clave existe, la reemplaza. */
  guardar(clave: string, contenido: Buffer, tipo: string): Promise<void>;
  /** Borra el archivo; si no existe, no hace nada ni falla. */
  borrar(clave: string): Promise<void>;
  /** URL pública de la clave (no comprueba que exista). */
  urlPublica(clave: string): string;
}
