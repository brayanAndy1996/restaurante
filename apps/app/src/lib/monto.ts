import Decimal from 'decimal.js';

/** Texto decimal de una persona o de la API ("120", "0.10") como `Decimal`; `null` si no es un número finito. */
export function comoDecimal(valor: string): Decimal | null {
  const texto = valor.trim();
  if (texto === '') return null;
  try {
    const d = new Decimal(texto);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * "1,234.50" a partir de un monto en texto decimal, sin pasar por números de coma flotante.
 * Redondea medio hacia arriba a `maxDecimales` y rellena con ceros hasta `minDecimales`.
 * Devuelve `null` si el texto no es un número.
 */
export function formatearMonto(
  valor: string,
  { minDecimales = 2, maxDecimales = 2 }: { minDecimales?: number; maxDecimales?: number } = {},
): string | null {
  const d = comoDecimal(valor);
  if (d === null) return null;
  const redondeado = d.toDecimalPlaces(maxDecimales, Decimal.ROUND_HALF_UP);
  const [entera = '0', fraccion = ''] = redondeado.abs().toFixed(maxDecimales).split('.');
  const util = fraccion.replace(/0+$/, '').padEnd(minDecimales, '0');
  const signo = redondeado.isNegative() && !redondeado.isZero() ? '-' : '';
  const miles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${signo}${miles}${util ? `.${util}` : ''}`;
}

/**
 * Monto escrito por una persona ("28", "28.5", "S/ 28.50") como texto decimal con 2 decimales ("28.50"),
 * el formato que acepta la API: hasta 8 enteros y 2 decimales, sin signo ni exponente. `null` si no es un
 * monto válido. Con `permitirCero` admite 0 (un precio extra); por defecto exige más de 0 (un precio).
 */
export function montoComoTexto(valor: string, { permitirCero = false } = {}): string | null {
  const limpio = valor.trim().replace(/^S\/\s*/i, '');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(limpio)) return null;
  const d = comoDecimal(limpio);
  if (d === null || d.isNegative()) return null;
  if (!permitirCero && d.isZero()) return null;
  return d.toFixed(2);
}

/** `true` si el texto decimal vale cero ("0", "0.00"); `false` si vale otra cosa o no es un número. */
export function montoEsCero(valor: string): boolean {
  return comoDecimal(valor)?.isZero() ?? false;
}

/**
 * "S/ 1,234.50" a partir de un monto en texto decimal; `null` si el texto no es un monto. El espacio es duro
 * (`\u00a0`): el monto no se parte entre "S/" y la cifra al cambiar de línea en pantallas de 360 px.
 */
export function montoEnSoles(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const formateado = formatearMonto(valor);
  return formateado === null ? null : `S/\u00a0${formateado}`;
}
