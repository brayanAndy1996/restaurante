/**
 * Montos de la orden (historia 004, criterios 21, 51 y 76; ruta crítica P1). Reciben y devuelven montos como
 * texto decimal con 2 decimales, calculan con `decimal.js` y, en las entradas, solo aceptan
 * `^\d{1,8}(\.\d{1,2})?$` (si no, `RangeError`). Sin redondeos y sin acotar: quien guarda compara con
 * `excedeMontoMaximo`.
 */
import Decimal from 'decimal.js';
import { CANTIDAD_MAXIMA_LINEA } from '../carta';

/**
 * Copia propia de `Decimal`: la configuración (precisión y redondeo) no depende de la que otro código haya
 * fijado en el `Decimal` global. Con 2 decimales en las entradas y cantidades enteras de hasta 999, todo cálculo
 * es exacto; la precisión sobra.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const FORMATO_MONTO = /^\d{1,8}(\.\d{1,2})?$/;
/** El total de una orden puede pasar de 8 enteros (no se acota): hasta 12, como los que da `totalOrden`. */
const FORMATO_TOTAL = /^\d{1,12}(\.\d{1,2})?$/;

function monto(valor: unknown, nombre: string, formato: RegExp): Decimal {
  if (typeof valor !== 'string' || !formato.test(valor)) {
    throw new RangeError(
      `${nombre} no es un monto válido: se esperaba un texto decimal con 2 decimales`,
    );
  }
  return new D(valor);
}

/** Mayor monto que cabe en una columna `NUMERIC(10,2)` (criterio 21). */
export const MONTO_MAXIMO = '99999999.99';

/** Un ítem tal como lo necesita `totalOrden`. */
export interface ItemParaTotal {
  precioUnitario: string;
  cantidad: number;
  cantidadAnulada: number;
}

/**
 * `precioUnitario × (cantidad − cantidadAnulada)`. `cantidad` entera de 1 a 999 y `cantidadAnulada` entera de 0
 * a `cantidad`; si no, `RangeError`.
 */
export function totalVigenteLinea(
  precioUnitario: string,
  cantidad: number,
  cantidadAnulada: number,
): string {
  const precio = monto(precioUnitario, 'El precio', FORMATO_MONTO);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA_LINEA) {
    throw new RangeError(`La cantidad debe ser un entero de 1 a ${CANTIDAD_MAXIMA_LINEA}`);
  }
  if (!Number.isInteger(cantidadAnulada) || cantidadAnulada < 0 || cantidadAnulada > cantidad) {
    throw new RangeError('La cantidad anulada debe ser un entero de 0 a la cantidad');
  }
  return precio.times(cantidad - cantidadAnulada).toFixed(2);
}

/** Suma de los totales vigentes de los ítems; una orden sin ítems da `"0.00"`. */
export function totalOrden(items: readonly ItemParaTotal[]): string {
  let suma = new D(0);
  for (const item of items) {
    suma = suma.plus(totalVigenteLinea(item.precioUnitario, item.cantidad, item.cantidadAnulada));
  }
  return suma.toFixed(2);
}

/** `true` si el monto pasa de `MONTO_MAXIMO` (acepta totales de hasta 12 enteros, como los de `totalOrden`). */
export function excedeMontoMaximo(valor: string): boolean {
  return monto(valor, 'El monto', FORMATO_TOTAL).greaterThan(MONTO_MAXIMO);
}
