/**
 * Aritmética de montos de caja (historia 006; ruta crítica P1): suma, resta, multiplicación y comparación de montos de
 * texto con 2 decimales, y los precios unitarios de una línea de comprobante (criterio 69). Todo con `decimal.js`: la
 * API y la PWA no calculan montos por su cuenta. Una entrada mal formada o un resultado fuera de rango es un
 * `RangeError`.
 */
import type { AfectacionIgv } from '../carta/catalogos';
import { D, ENTEROS_TOTAL, dos, entero, monto, suma, tasa, type Dec } from './comun';

const leer = (valor: string): Dec => monto(valor, 'El monto', ENTEROS_TOTAL);

/** La suma de montos no negativos con hasta 2 decimales, con 2 decimales. */
export function sumarMontos(montos: readonly string[]): string {
  return dos(suma(montos.map(leer)));
}

/**
 * `a − b` con 2 decimales. Si `b` es mayor que `a` lanza `RangeError`: un saldo negativo es un dato inconsistente y no
 * debe esconderse como `0.00`.
 */
export function restarMontos(a: string, b: string): string {
  const resta = leer(a).minus(leer(b));
  if (resta.isNegative() && !resta.isZero()) {
    throw new RangeError(`La resta ${a} − ${b} da un monto negativo`);
  }
  return dos(resta);
}

/** `monto × cantidad` (entera, de 0 a 999999), con 2 decimales. */
export function multiplicarMonto(valor: string, cantidad: number): string {
  return dos(leer(valor).times(entero(cantidad, 'La cantidad', 0, 999_999)));
}

/** Compara dos montos: negativo si `a < b`, cero si son iguales, positivo si `a > b`. */
export function compararMontos(a: string, b: string): number {
  return leer(a).cmp(leer(b));
}

/** Los precios unitarios de una línea de comprobante (criterio 69). */
export interface PreciosUnitarios {
  /** Con IGV, 2 decimales. */
  precioUnitario: string;
  /** Sin IGV, 10 decimales, antes del descuento. */
  valorUnitario: string;
}

/**
 * Precio y valor unitario de una línea (criterio 69). El precio unitario es `base` entre `cantidad` (`base` es el
 * bruto de la línea, o el valor referencial si es gratuita; con la cantidad de la línea es exacto) con 2 decimales. El
 * valor unitario es: en una línea `GRAVADO` con tasa, `precio / (1 + tasa / 100)`; en una `EXONERADO`, `INAFECTO` o sin
 * tasa (Nuevo RUS), el precio; siempre con 10 decimales y la mitad hacia arriba.
 */
export function preciosUnitarios(entrada: {
  base: string;
  cantidad: number;
  afectacion: AfectacionIgv;
  tasaIgv: string | null;
}): PreciosUnitarios {
  const cantidad = entero(entrada.cantidad, 'La cantidad', 1, 999_999);
  const precio = leer(entrada.base).div(cantidad).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const conIgv = entrada.afectacion === 'GRAVADO' && entrada.tasaIgv !== null;
  const valor = conIgv
    ? precio.div(new D(1).plus(tasa(entrada.tasaIgv, 'La tasa de IGV').div(100)))
    : precio;
  return {
    precioUnitario: precio.toFixed(2),
    valorUnitario: valor.toDecimalPlaces(10, D.ROUND_HALF_UP).toFixed(10),
  };
}
