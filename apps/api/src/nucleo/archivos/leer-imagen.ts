/**
 * Lee el formato y las dimensiones de una imagen por su contenido, sin dependencias nativas ni decodificar los
 * píxeles (historia 003, criterio 14). Reconoce JPEG, PNG y WebP por su firma (no por el `Content-Type` ni la
 * extensión) y recorre su estructura (marcadores de JPEG, bloques de PNG, bloques RIFF de WebP) para comprobar
 * que el archivo no está truncado y para leer el ancho y el alto.
 */

export type FormatoImagen = 'jpeg' | 'png' | 'webp';

export interface ImagenLeida {
  formato: FormatoImagen;
  /** `Content-Type` que corresponde al formato. */
  tipo: `image/${FormatoImagen}`;
  /** Extensión de la clave del archivo (`jpg`, `png` o `webp`). */
  extension: 'jpg' | 'png' | 'webp';
  ancho: number;
  alto: number;
}

const TIPO_DE_FORMATO = {
  jpeg: { tipo: 'image/jpeg', extension: 'jpg' },
  png: { tipo: 'image/png', extension: 'png' },
  webp: { tipo: 'image/webp', extension: 'webp' },
} as const;

/** Los tres `Content-Type` que acepta la subida de una foto. */
export const TIPOS_DE_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'] as const;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function resultado(formato: FormatoImagen, ancho: number, alto: number): ImagenLeida | null {
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho < 1 || alto < 1) return null;
  return { formato, ...TIPO_DE_FORMATO[formato], ancho, alto };
}

/** Marcadores SOF (inicio de cuadro) de JPEG: llevan la precisión, el alto y el ancho. */
const esMarcadorSof = (marcador: number): boolean =>
  marcador >= 0xc0 &&
  marcador <= 0xcf &&
  marcador !== 0xc4 && // DHT
  marcador !== 0xc8 && // JPG (reservado)
  marcador !== 0xcc; // DAC

function leerJpeg(b: Buffer): ImagenLeida | null {
  // Un JPEG completo termina con el marcador EOI (FF D9); se toleran ceros de relleno al final.
  let fin = b.length;
  while (fin > 2 && b[fin - 1] === 0x00) fin--;
  if (b[fin - 2] !== 0xff || b[fin - 1] !== 0xd9) return null;

  let pos = 2; // tras FF D8
  while (pos < fin) {
    if (b[pos] !== 0xff) return null;
    while (b[pos] === 0xff) pos++; // bytes de relleno antes del marcador
    const marcador = b[pos++];
    if (marcador === undefined) return null;
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) continue;
    // EOI o inicio del escaneo antes de un cuadro: no hay dimensiones que leer.
    if (marcador === 0xd9 || marcador === 0xda) return null;
    if (pos + 2 > fin) return null;
    const largo = b.readUInt16BE(pos);
    if (largo < 2 || pos + largo > fin) return null;
    if (esMarcadorSof(marcador)) {
      if (largo < 8) return null;
      return resultado('jpeg', b.readUInt16BE(pos + 5), b.readUInt16BE(pos + 3));
    }
    pos += largo;
  }
  return null;
}

function leerPng(b: Buffer): ImagenLeida | null {
  let pos = FIRMA_PNG.length;
  let ancho = 0;
  let alto = 0;
  let primero = true;
  while (pos + 12 <= b.length) {
    const largo = b.readUInt32BE(pos);
    const tipo = b.toString('latin1', pos + 4, pos + 8);
    const siguiente = pos + 12 + largo;
    if (siguiente > b.length) return null; // trozo truncado
    if (primero) {
      if (tipo !== 'IHDR' || largo !== 13) return null;
      ancho = b.readUInt32BE(pos + 8);
      alto = b.readUInt32BE(pos + 12);
      primero = false;
    }
    if (tipo === 'IEND') return siguiente === b.length ? resultado('png', ancho, alto) : null;
    pos = siguiente;
  }
  return null; // sin IEND: truncado
}

function leerWebp(b: Buffer): ImagenLeida | null {
  if (b.length < 30) return null;
  // El tamaño del RIFF cuenta todo lo que sigue a los 8 primeros bytes: si no coincide, está truncado.
  if (b.readUInt32LE(4) + 8 !== b.length) return null;
  const trozo = b.toString('latin1', 12, 16);
  if (trozo === 'VP8 ') {
    // Con pérdida: etiqueta de cuadro de 3 bytes, código de inicio 9D 01 2A y 14 bits por lado.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return resultado('webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  if (trozo === 'VP8L') {
    // Sin pérdida: firma 0x2F y, en 14 bits cada uno, ancho − 1 y alto − 1.
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return resultado('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (trozo === 'VP8X') {
    // Extendido: ancho − 1 y alto − 1 en 24 bits cada uno.
    return resultado('webp', b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  }
  return null;
}

/**
 * Formato y dimensiones de la imagen, o `null` si no es un JPEG, PNG o WebP completo y legible (otro
 * formato, firma que no coincide, archivo truncado o dimensiones ilegibles). Nunca lanza.
 */
export function leerImagen(contenido: Buffer): ImagenLeida | null {
  try {
    if (
      contenido.length >= 3 &&
      contenido[0] === 0xff &&
      contenido[1] === 0xd8 &&
      contenido[2] === 0xff
    ) {
      return leerJpeg(contenido);
    }
    if (contenido.length >= FIRMA_PNG.length && contenido.subarray(0, 8).equals(FIRMA_PNG)) {
      return leerPng(contenido);
    }
    if (
      contenido.length >= 12 &&
      contenido.toString('latin1', 0, 4) === 'RIFF' &&
      contenido.toString('latin1', 8, 12) === 'WEBP'
    ) {
      return leerWebp(contenido);
    }
    return null;
  } catch {
    // Una lectura fuera de rango en un archivo corrupto no puede tumbar la petición.
    return null;
  }
}
