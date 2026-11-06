/**
 * El almacén privado de comprobantes (historia 006, entrega 6b, criterios 131 y 165): el XML, el CDR y el PDF viven
 * aquí, bajo `comprobantes/<empresaId>/<comprobanteId>/…`, y **ninguna ruta los sirve por una URL directa** (a
 * diferencia de `AlmacenArchivos`, que es el de las fotos y es público). Implementaciones: `AlmacenComprobantesEnMemoria`
 * (pruebas), disco (desarrollo, `./archivos-privados`) y R2 con un bucket privado (T31).
 */

/** Token de Nest del almacén privado de comprobantes. */
export const ALMACEN_COMPROBANTES = Symbol('ALMACEN_COMPROBANTES');

export interface AlmacenComprobantes {
  /** Guarda `contenido` bajo `clave` con su `Content-Type`; si la clave existe, la reemplaza (la clave es fija por comprobante). */
  guardar(clave: string, contenido: Buffer, tipo: string): Promise<void>;
  /** Lee el archivo o devuelve `null` si no existe. */
  leer(clave: string): Promise<Buffer | null>;
}

/** La clave de un archivo de un comprobante: `comprobantes/<empresaId>/<comprobanteId>/<nombre>`. */
export function claveDeArchivoDeComprobante(
  empresaId: string,
  comprobanteId: string,
  nombre: 'documento.xml' | 'cdr.zip' | 'cdr.xml' | 'representacion.pdf',
): string {
  return `comprobantes/${empresaId}/${comprobanteId}/${nombre}`;
}
