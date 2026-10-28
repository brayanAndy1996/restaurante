/**
 * Reducir la foto de un producto en el navegador antes de subirla (decisión 1 de la sección 003): lado
 * mayor de 1200 px, JPEG de unos 150 a 300 KB. Con datos móviles, una foto de celular de 4 MB no se
 * sube entera. La API acepta hasta 1 MB y de 200 a 2048 px por lado, y decide qué es válido; aquí se
 * reduce y solo se avisa de lo que ya se sabe que la API rechazaría.
 */

/** Lado mayor de la foto que se sube. */
export const LADO_MAYOR_PX = 1200;
/** Lado menor que acepta la API. */
export const LADO_MENOR_MINIMO_PX = 200;
/** Peso al que apunta la reducción: se baja la calidad hasta quedar por debajo. */
export const PESO_OBJETIVO_BYTES = 300 * 1024;
/** Peso máximo que acepta la API (1 MB). */
export const PESO_MAXIMO_BYTES = 1_048_576;
/** Calidades que se prueban, de la mejor a la peor, hasta llegar al peso objetivo. */
export const CALIDADES_JPEG = [0.82, 0.72, 0.62, 0.52] as const;

const TIPOS_DE_LA_API = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type MotivoDeFoto = 'NO_SE_PUDO_LEER' | 'MUY_PEQUENA' | 'FORMA_NO_VALIDA' | 'MUY_PESADA';

/** La foto no sirve y subirla sería inútil: el mensaje ya dice qué hacer. */
export class ErrorDeFoto extends Error {
  readonly motivo: MotivoDeFoto;
  constructor(motivo: MotivoDeFoto, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeFoto';
    this.motivo = motivo;
  }
}

export interface ImagenDecodificada {
  ancho: number;
  alto: number;
  origen: CanvasImageSource;
  liberar: () => void;
}

/** Las dos operaciones del navegador que usa la reducción; se cambian en las pruebas (jsdom no dibuja). */
export interface MotorDeImagen {
  decodificar: (archivo: Blob) => Promise<ImagenDecodificada>;
  codificar: (
    origen: CanvasImageSource,
    ancho: number,
    alto: number,
    calidad: number,
  ) => Promise<Blob | null>;
}

async function decodificarConImagen(archivo: Blob): Promise<ImagenDecodificada> {
  const url = URL.createObjectURL(archivo);
  const imagen = new Image();
  imagen.src = url;
  try {
    await imagen.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    ancho: imagen.naturalWidth,
    alto: imagen.naturalHeight,
    origen: imagen,
    liberar: () => URL.revokeObjectURL(url),
  };
}

/** El navegador real: `createImageBitmap` (corrige la orientación EXIF) y, si no existe, un `<img>`. */
export const motorDelNavegador: MotorDeImagen = {
  async decodificar(archivo) {
    if (typeof createImageBitmap !== 'function') return decodificarConImagen(archivo);
    let mapa: ImageBitmap;
    try {
      mapa = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch (error) {
      // Algunos navegadores no aceptan las opciones; sin ellas ya corrigen la orientación por defecto.
      if (error instanceof TypeError) mapa = await createImageBitmap(archivo);
      else throw error;
    }
    return { ancho: mapa.width, alto: mapa.height, origen: mapa, liberar: () => mapa.close() };
  },
  async codificar(origen, ancho, alto, calidad) {
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const contexto = lienzo.getContext('2d');
    if (!contexto) return null;
    // Un PNG con transparencia pasaría a JPEG con fondo negro: se pinta primero de blanco.
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, ancho, alto);
    contexto.imageSmoothingQuality = 'high';
    contexto.drawImage(origen, 0, 0, ancho, alto);
    return new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, 'image/jpeg', calidad));
  },
};

/** Tamaño de la foto reducida: el lado mayor a 1200 px (o menos, si ya era más chica), sin deformarla. */
export function tamanoReducido(ancho: number, alto: number): { ancho: number; alto: number } {
  const escala = Math.min(1, LADO_MAYOR_PX / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/**
 * Devuelve la foto lista para subir: un JPEG de 1200 px de lado mayor y, en lo posible, de hasta 300 KB.
 * Si el navegador no puede leerla (por ejemplo, un HEIC en Chrome) y ya es JPEG, PNG o WebP de hasta
 * 1 MB, se sube tal cual y la API decide; si no, lanza `ErrorDeFoto`.
 */
export async function reducirFoto(
  archivo: Blob,
  motor: MotorDeImagen = motorDelNavegador,
): Promise<Blob> {
  let imagen: ImagenDecodificada;
  try {
    imagen = await motor.decodificar(archivo);
  } catch {
    if (TIPOS_DE_LA_API.has(archivo.type) && archivo.size <= PESO_MAXIMO_BYTES) return archivo;
    throw new ErrorDeFoto(
      'NO_SE_PUDO_LEER',
      'No pudimos leer esta foto. Prueba con otra en JPEG, PNG o WebP.',
    );
  }
  try {
    if (Math.min(imagen.ancho, imagen.alto) < LADO_MENOR_MINIMO_PX) {
      throw new ErrorDeFoto(
        'MUY_PEQUENA',
        `La foto es muy pequeña. Necesita al menos ${LADO_MENOR_MINIMO_PX} píxeles de lado: toma una más de cerca o con mejor resolución.`,
      );
    }
    const { ancho, alto } = tamanoReducido(imagen.ancho, imagen.alto);
    if (Math.min(ancho, alto) < LADO_MENOR_MINIMO_PX) {
      throw new ErrorDeFoto(
        'FORMA_NO_VALIDA',
        'La foto es demasiado alargada. Elige una más cuadrada.',
      );
    }
    let resultado: Blob | null = null;
    for (const calidad of CALIDADES_JPEG) {
      resultado = await motor.codificar(imagen.origen, ancho, alto, calidad);
      if (resultado === null) break;
      if (resultado.size <= PESO_OBJETIVO_BYTES) break;
    }
    if (resultado === null) {
      throw new ErrorDeFoto(
        'NO_SE_PUDO_LEER',
        'No pudimos preparar esta foto. Prueba con otra o inténtalo de nuevo.',
      );
    }
    if (resultado.size > PESO_MAXIMO_BYTES) {
      throw new ErrorDeFoto('MUY_PESADA', 'La foto pesa demasiado. Elige otra más liviana.');
    }
    return resultado;
  } finally {
    imagen.liberar();
  }
}
