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

/** Lo único que puede llevar una clave: letras, cifras, guion, guion bajo y barras entre carpetas, con una extensión al final. */
const CLAVE_VALIDA = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\.[A-Za-z0-9]+)?$/;

/**
 * Si `clave` tiene la forma que arma la API: sin `..` ni `.` como carpeta, sin segmentos vacíos, sin barra inicial o final, sin
 * `\`, espacios, `?`, `#` ni `%`. Todas las implementaciones del almacén la exigen igual (criterio 131): una clave con `..`
 * puede resolverse en el bucket a la carpeta de otra empresa.
 */
export function esClaveValidaDeComprobante(clave: string): boolean {
  return clave.length > 0 && clave.length <= 300 && CLAVE_VALIDA.test(clave);
}

/** Lanza `RangeError` si la clave no es válida para el almacén de comprobantes. */
export function exigirClaveValidaDeComprobante(clave: string): void {
  if (!esClaveValidaDeComprobante(clave)) {
    throw new RangeError('La clave del archivo no es válida para el almacén de comprobantes');
  }
}

/** Si `clave` es exactamente la del PDF del comprobante de la empresa (igualdad, no prefijo; criterios 165 y 167). */
export function esClaveDelPdfDe(clave: string, empresaId: string, comprobanteId: string): boolean {
  return clave === claveDeArchivoDeComprobante(empresaId, comprobanteId, 'representacion.pdf');
}
