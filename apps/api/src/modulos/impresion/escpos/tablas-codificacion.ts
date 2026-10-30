import type { JuegoCaracteres } from '@restaurante/contratos';

/**
 * Codificación del texto de un ticket (historia 004, criterio 123). Las tablas son propias del renderizador (no
 * comparten código con las del emulador de pruebas): la prueba las compara con la decodificación del emulador.
 *
 * `adaptarTexto` deja un texto en el que todo carácter existe en la página de códigos del juego (o es ASCII
 * imprimible), sustituyendo lo que no existe; el ajuste a columnas se hace sobre ese texto, porque una
 * sustitución puede cambiar el largo ("×" → "x", "€" → "EUR", "¿" → ""). `codificarTexto` lo convierte en bytes.
 */

/** Páginas de códigos que el renderizador sabe elegir con `ESC t n`. */
export type PaginaDeCodigos = 'PC437' | 'PC850' | 'PC858' | 'WPC1252';

/** El número de `ESC t n` de cada página (Epson y compatibles). */
export const NUMERO_DE_PAGINA: Readonly<Record<PaginaDeCodigos, number>> = {
  PC437: 0,
  PC850: 2,
  PC858: 19,
  WPC1252: 16,
};

/**
 * La página que se elige para un juego de caracteres: `SIN_TILDES` usa PC437 con texto ASCII (la página por
 * defecto de casi toda impresora). Cualquier página sirve a un texto ASCII.
 */
export function paginaDeJuego(juego: JuegoCaracteres): PaginaDeCodigos {
  return juego === 'SIN_TILDES' ? 'PC437' : juego;
}

/** Los 128 caracteres de los bytes 0x80 a 0xFF de cada página; U+FFFD marca un byte sin carácter. */
const TABLAS_ALTAS: Readonly<Record<PaginaDeCodigos, string>> = {
  PC437: [
    '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5',
    '\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192',
    '\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb',
    '\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510',
    '\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567',
    '\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580',
    '\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229',
    '\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0',
  ].join(''),
  PC850: [
    '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5',
    '\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192',
    '\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb',
    '\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510',
    '\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4',
    '\u00f0\u00d0\u00ca\u00cb\u00c8\u0131\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580',
    '\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4',
    '\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0',
  ].join(''),
  PC858: [
    '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5',
    '\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192',
    '\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb',
    '\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u00c0\u00a9\u2563\u2551\u2557\u255d\u00a2\u00a5\u2510',
    '\u2514\u2534\u252c\u251c\u2500\u253c\u00e3\u00c3\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4',
    '\u00f0\u00d0\u00ca\u00cb\u00c8\u20ac\u00cd\u00ce\u00cf\u2518\u250c\u2588\u2584\u00a6\u00cc\u2580',
    '\u00d3\u00df\u00d4\u00d2\u00f5\u00d5\u00b5\u00fe\u00de\u00da\u00db\u00d9\u00fd\u00dd\u00af\u00b4',
    '\u00ad\u00b1\u2017\u00be\u00b6\u00a7\u00f7\u00b8\u00b0\u00a8\u00b7\u00b9\u00b3\u00b2\u25a0\u00a0',
  ].join(''),
  WPC1252: [
    '\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\u017d\ufffd',
    '\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\u017e\u0178',
    '\u00a0\u00a1\u00a2\u00a3\u00a4\u00a5\u00a6\u00a7\u00a8\u00a9\u00aa\u00ab\u00ac\u00ad\u00ae\u00af',
    '\u00b0\u00b1\u00b2\u00b3\u00b4\u00b5\u00b6\u00b7\u00b8\u00b9\u00ba\u00bb\u00bc\u00bd\u00be\u00bf',
    '\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c6\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf',
    '\u00d0\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d7\u00d8\u00d9\u00da\u00db\u00dc\u00dd\u00de\u00df',
    '\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef',
    '\u00f0\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f7\u00f8\u00f9\u00fa\u00fb\u00fc\u00fd\u00fe\u00ff',
  ].join(''),
};

const ASCII_IMPRIMIBLE = /^[ -~]$/;

const CODIGOS: Readonly<Record<PaginaDeCodigos, ReadonlyMap<string, number>>> = Object.fromEntries(
  (Object.keys(TABLAS_ALTAS) as PaginaDeCodigos[]).map((pagina) => [
    pagina,
    new Map(
      Array.from(TABLAS_ALTAS[pagina], (caracter, i) => [caracter, 0x80 + i] as const).filter(
        ([caracter]) => caracter !== '�',
      ),
    ),
  ]),
) as unknown as Record<PaginaDeCodigos, ReadonlyMap<string, number>>;

/** Lo que se escribe en lugar de un carácter que la página no tiene y que no se arregla quitándole la tilde. */
const SUSTITUCIONES: Readonly<Record<string, string>> = {
  '×': 'x',
  '·': '-',
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  '€': 'EUR',
  ' ': ' ',
  ß: 'ss',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  đ: 'd',
  Đ: 'D',
  ł: 'l',
  Ł: 'L',
};

/** `SIN_TILDES` quita los signos de apertura (criterio 123: "¿" → ""). */
const SE_QUITAN_SIN_TILDES: ReadonlySet<string> = new Set(['¿', '¡']);

const MARCAS_COMBINANTES = /[̀-ͯ]/g;

const esDeControl = (caracter: string): boolean => {
  const codigo = caracter.codePointAt(0)!;
  return codigo < 0x20 || (codigo >= 0x7f && codigo <= 0x9f);
};

/**
 * Lo más largo que puede ser el reemplazo de **un** carácter que la página no tiene (ronda 3 del ataque, criterio
 * 123): "…" → "...", "€" → "EUR", "ǆ" → "dz". Si la descomposición es más larga (U+FDFA "ﷺ" se descompone en 18
 * caracteres) el reemplazo es un solo `?`. Así un texto adaptado nunca pesa más de este múltiplo de lo que mide en
 * el documento (`textoSchema` cuenta un carácter por cada uno).
 */
export const MAXIMO_REEMPLAZO = 3;

/** Reemplazos ya calculados, por página y modo: `sustituir` repite los mismos pocos caracteres miles de veces. */
const CACHE_DE_REEMPLAZOS = new Map<string, Map<string, string>>();
const MAXIMO_EN_CACHE = 2048;

/** El texto con el carácter reemplazado por algo que la página pueda escribir (o `?`); a lo más `MAXIMO_REEMPLAZO`. */
function sustituir(caracter: string, pagina: PaginaDeCodigos, sinTildes: boolean): string {
  const clave = `${pagina}${sinTildes ? '-' : '+'}`;
  let cache = CACHE_DE_REEMPLAZOS.get(clave);
  if (cache === undefined) {
    cache = new Map();
    CACHE_DE_REEMPLAZOS.set(clave, cache);
  }
  const guardado = cache.get(caracter);
  if (guardado !== undefined) return guardado;
  const calculado = calcularReemplazo(caracter, pagina, sinTildes);
  if (cache.size >= MAXIMO_EN_CACHE) cache.clear();
  cache.set(caracter, calculado);
  return calculado;
}

function calcularReemplazo(caracter: string, pagina: PaginaDeCodigos, sinTildes: boolean): string {
  if (sinTildes && SE_QUITAN_SIN_TILDES.has(caracter)) return '';
  const tabla = CODIGOS[pagina];
  const fijo = SUSTITUCIONES[caracter];
  const candidato = fijo ?? caracter.normalize('NFKD').replace(MARCAS_COMBINANTES, '');
  const letras = Array.from(candidato);
  // Una descomposición larga (compatibilidad de "ﷺ", "㍿"...) no se escribe: un solo `?`.
  if (letras.length > MAXIMO_REEMPLAZO) return '?';
  let resultado = '';
  for (const c of letras) {
    resultado += ASCII_IMPRIMIBLE.test(c) || (!sinTildes && tabla.has(c)) ? c : '?';
  }
  return resultado;
}

/**
 * Deja el texto en lo que el juego de caracteres puede escribir. Lo que no existe en la página se reemplaza
 * ("Á" → "A" en PC437, "×" → "x"); en `SIN_TILDES` todo sale en ASCII ("Ají" → "Aji", "Ñ" → "N", "¿" → "").
 * Los caracteres de control se vuelven espacios y lo desconocido, `?`. Cada carácter da a lo más `MAXIMO_REEMPLAZO`
 * caracteres: el texto adaptado mide como mucho eso por el del documento.
 */
export function adaptarTexto(texto: string, juego: JuegoCaracteres): string {
  const pagina = paginaDeJuego(juego);
  const sinTildes = juego === 'SIN_TILDES';
  const tabla = CODIGOS[pagina];
  let salida = '';
  for (const caracter of texto.normalize('NFC')) {
    if (ASCII_IMPRIMIBLE.test(caracter) || (!sinTildes && tabla.has(caracter))) salida += caracter;
    else if (esDeControl(caracter)) salida += ' ';
    else salida += sustituir(caracter, pagina, sinTildes);
  }
  return salida;
}

/** Los bytes de un texto ya adaptado; lo que no exista en la página sale como `?`. */
export function codificarTexto(textoAdaptado: string, juego: JuegoCaracteres): number[] {
  const tabla = CODIGOS[paginaDeJuego(juego)];
  const sinTildes = juego === 'SIN_TILDES';
  const bytes: number[] = [];
  for (const caracter of textoAdaptado) {
    if (ASCII_IMPRIMIBLE.test(caracter)) bytes.push(caracter.charCodeAt(0));
    else bytes.push(sinTildes ? 0x3f : (tabla.get(caracter) ?? 0x3f));
  }
  return bytes;
}
