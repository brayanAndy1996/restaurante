/**
 * Color de la marca de la carta web (historia 005, criterio 89; no es ruta crítica). El color del restaurante se
 * usa como fondo de la acción principal y del encabezado con texto blanco encima; si no alcanza el contraste de
 * 4.5:1 de WCAG 2.2 AA, se oscurece hasta alcanzarlo.
 */

const FORMATO_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Texto sobre el color de la marca. */
export const COLOR_SOBRE_MARCA = '#FFFFFF';

/** Contraste mínimo de WCAG 2.2 AA para texto normal. */
export const CONTRASTE_MINIMO = 4.5;

type Rgb = readonly [number, number, number];

function aRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function aHex(rgb: Rgb): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminancia([r, g, b]: Rgb): number {
  const lineal = (canal: number): number => {
    const c = canal / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
}

/** Razón de contraste de WCAG entre dos colores `#RRGGBB` (de 1 a 21). */
export function contraste(a: string, b: string): number {
  const la = luminancia(aRgb(a));
  const lb = luminancia(aRgb(b));
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/**
 * `{ fondo, texto }` para pintar con la marca: `texto` es siempre blanco y `fondo` es el color pedido si su
 * contraste con el blanco es de 4.5:1 o más, o el color más cercano que se obtiene oscureciéndolo (todos los
 * canales por el mismo factor, que baja de a 0.5 %) hasta alcanzarlo. En mayúsculas. Lanza `RangeError` si
 * `hex` no es `#RRGGBB`.
 */
export function colorDeMarcaAccesible(hex: string): { fondo: string; texto: string } {
  if (typeof hex !== 'string' || !FORMATO_COLOR.test(hex)) {
    throw new RangeError('El color debe tener el formato #RRGGBB');
  }
  const original = aRgb(hex);
  for (let paso = 0; paso <= 200; paso += 1) {
    const factor = 1 - paso * 0.005;
    const candidato = aHex(original.map((c) => Math.round(c * factor)) as unknown as Rgb);
    if (contraste(candidato, COLOR_SOBRE_MARCA) >= CONTRASTE_MINIMO) {
      return { fondo: candidato, texto: COLOR_SOBRE_MARCA };
    }
  }
  return { fondo: '#000000', texto: COLOR_SOBRE_MARCA };
}
