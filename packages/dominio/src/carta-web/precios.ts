import Decimal from 'decimal.js';

/**
 * Cómo se muestra y se lee un precio en la carta web (historia 005, criterios 81 y 90; no es ruta crítica). Los
 * precios llegan de la API como texto decimal con 2 decimales y aquí solo se les da forma: ninguna cuenta se hace
 * con números de coma flotante.
 */

/** Copia propia de `Decimal`: no depende de la configuración que otro código haya fijado en el global. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const FORMATO_PRECIO = /^\d{1,12}(\.\d{1,2})?$/;

function leer(valor: string): Decimal {
  if (typeof valor !== 'string' || !FORMATO_PRECIO.test(valor)) {
    throw new RangeError('El precio debe ser un texto decimal con hasta 2 decimales');
  }
  return new D(valor);
}

/**
 * `"S/ 28.00"` a partir de `"28"` o `"28.5"`; siempre con 2 decimales y sin separador de miles. El espacio es duro
 * (`\u00a0`): un precio nunca se parte entre "S/" y la cifra. Lanza `RangeError` si no es un precio.
 */
export function precioEnSoles(valor: string): string {
  return `S/\u00a0${leer(valor).toFixed(2)}`;
}

/**
 * El precio como lo lee un lector de pantalla: `"28 soles"`, `"1 sol"`, `"28 soles con 50 céntimos"`,
 * `"0 soles con 50 céntimos"`. Lanza `RangeError` si no es un precio.
 */
export function precioLeido(valor: string): string {
  const monto = leer(valor);
  const soles = monto.floor();
  const centimos = monto.minus(soles).times(100).toNumber();
  const partes = [`${soles.toFixed(0)} ${soles.eq(1) ? 'sol' : 'soles'}`];
  if (centimos > 0) partes.push(`${centimos} ${centimos === 1 ? 'céntimo' : 'céntimos'}`);
  return partes.join(' con ');
}

/** `true` si el precio es cero (`"0"`, `"0.00"`): un extra gratis no se anuncia. Lanza `RangeError` si no es un precio. */
export function precioEsCero(valor: string): boolean {
  return leer(valor).isZero();
}
