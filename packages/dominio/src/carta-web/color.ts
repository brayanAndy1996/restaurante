/**
 * Color de la marca de la carta web (historia 005, criterio 89; no es ruta crítica). El color del restaurante se
 * usa tal como lo eligió como fondo de la acción principal y del encabezado (decisión del usuario del
 * 2026-11-03: no se oscurece); lo que cambia es el texto encima, que es blanco o casi negro, el que alcance el
 * contraste de 4.5:1 de WCAG 2.2 AA.
 */

const FORMATO_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** Texto sobre la marca cuando el blanco contrasta lo suficiente. */
export const COLOR_SOBRE_MARCA = '#FFFFFF';

/** Texto sobre la marca cuando el blanco no alcanza: un casi negro fijo (no el negro puro). */
export const COLOR_SOBRE_MARCA_CLARA = '#111111';

/** Último recurso: el negro puro contrasta al menos 4.58:1 con cualquier color que no alcance los dos de arriba. */
const NEGRO = '#000000';

/** Contraste mínimo de WCAG 2.2 AA para un control o indicador gráfico. */
export const CONTRASTE_MINIMO_CONTROL = 3;

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

function validar(hex: string): void {
  if (typeof hex !== 'string' || !FORMATO_COLOR.test(hex)) {
    throw new RangeError('El color debe tener el formato #RRGGBB');
  }
}

/** El texto que se lee sobre `fondo` (en mayúsculas, `#RRGGBB`): blanco, casi negro o negro, en ese orden. */
function textoSobre(fondo: string): string {
  for (const texto of [COLOR_SOBRE_MARCA, COLOR_SOBRE_MARCA_CLARA]) {
    if (contraste(fondo, texto) >= CONTRASTE_MINIMO) return texto;
  }
  return NEGRO;
}

/**
 * `{ fondo, texto }` para pintar con la marca. `fondo` es siempre el color pedido, en mayúsculas, sin tocarlo.
 * `texto` es `#FFFFFF` si su contraste con `fondo` es de 4.5:1 o más; si no, un casi negro fijo (`#111111`) si
 * alcanza 4.5:1; y si tampoco, `#000000`, que con cualquier color da al menos 4.58:1. Lanza `RangeError` si `hex`
 * no es `#RRGGBB`.
 */
export function colorDeMarcaAccesible(hex: string): { fondo: string; texto: string } {
  validar(hex);
  const fondo = hex.toUpperCase();
  return { fondo, texto: textoSobre(fondo) };
}

/**
 * El color para los indicadores que van sobre fondo blanco (el radio y la casilla marcados, el borde de la opción
 * elegida): la marca si contrasta 3:1 o más con el blanco y, si no, el `texto` de `colorDeMarcaAccesible`, que
 * siempre es oscuro cuando la marca es clara. En mayúsculas. Lanza `RangeError` si `hex` no es `#RRGGBB`.
 */
export function colorDeMarcaSobreBlanco(hex: string): string {
  const { fondo, texto } = colorDeMarcaAccesible(hex);
  return contraste(fondo, COLOR_SOBRE_MARCA) >= CONTRASTE_MINIMO_CONTROL ? fondo : texto;
}
