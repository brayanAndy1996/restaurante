import {
  CALIDADES_JPEG,
  ErrorDeFoto,
  PESO_MAXIMO_BYTES,
  PESO_OBJETIVO_BYTES,
  motorDelNavegador,
  type MotorDeImagen,
} from '../../../lib/imagen';

/**
 * Preparar el logo antes de subirlo (criterio 3 de 005): la API acepta JPEG, PNG o WebP de hasta 1 MB y de 64 a
 * 2048 píxeles por lado. Un logo que ya cumple se sube tal cual, para no perder su transparencia ni su nitidez;
 * uno demasiado grande o pesado se reduce a 1024 px de lado mayor (JPEG, con fondo blanco).
 */

export const LADO_MENOR_MINIMO_LOGO_PX = 64;
export const LADO_MAYOR_MAXIMO_LOGO_PX = 2048;
export const LADO_MAYOR_REDUCIDO_LOGO_PX = 1024;

const TIPOS_DE_LA_API = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function prepararLogo(
  archivo: Blob,
  motor: MotorDeImagen = motorDelNavegador,
): Promise<Blob> {
  const sirveTalCual = TIPOS_DE_LA_API.has(archivo.type) && archivo.size <= PESO_MAXIMO_BYTES;
  let imagen;
  try {
    imagen = await motor.decodificar(archivo);
  } catch {
    // El navegador no pudo leerla (por ejemplo, un HEIC): si la API la acepta por su tipo y peso, ella decide.
    if (sirveTalCual) return archivo;
    throw new ErrorDeFoto(
      'NO_SE_PUDO_LEER',
      'No pudimos leer este logo. Prueba con otro en JPEG, PNG o WebP.',
    );
  }
  try {
    const { ancho, alto } = imagen;
    if (Math.min(ancho, alto) < LADO_MENOR_MINIMO_LOGO_PX) {
      throw new ErrorDeFoto(
        'MUY_PEQUENA',
        `El logo es muy pequeño. Necesita al menos ${LADO_MENOR_MINIMO_LOGO_PX} píxeles de lado: usa una imagen de mejor resolución.`,
      );
    }
    if (sirveTalCual && Math.max(ancho, alto) <= LADO_MAYOR_MAXIMO_LOGO_PX) return archivo;

    const escala = Math.min(1, LADO_MAYOR_REDUCIDO_LOGO_PX / Math.max(ancho, alto));
    const anchoFinal = Math.round(ancho * escala);
    const altoFinal = Math.round(alto * escala);
    if (Math.min(anchoFinal, altoFinal) < LADO_MENOR_MINIMO_LOGO_PX) {
      throw new ErrorDeFoto(
        'FORMA_NO_VALIDA',
        'El logo es demasiado alargado. Usa una imagen más cuadrada.',
      );
    }
    let resultado: Blob | null = null;
    for (const calidad of CALIDADES_JPEG) {
      resultado = await motor.codificar(imagen.origen, anchoFinal, altoFinal, calidad);
      if (resultado === null || resultado.size <= PESO_OBJETIVO_BYTES) break;
    }
    if (resultado === null) {
      throw new ErrorDeFoto(
        'NO_SE_PUDO_LEER',
        'No pudimos preparar este logo. Prueba con otro o inténtalo de nuevo.',
      );
    }
    if (resultado.size > PESO_MAXIMO_BYTES) {
      throw new ErrorDeFoto('MUY_PESADA', 'El logo pesa demasiado. Usa una imagen más liviana.');
    }
    return resultado;
  } finally {
    imagen.liberar();
  }
}
