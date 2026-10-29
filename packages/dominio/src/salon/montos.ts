/**
 * Montos de la orden (historia 004, criterios 21, 51 y 76; ruta crítica P1). Reciben y devuelven montos como
 * texto decimal con 2 decimales, calculan con `decimal.js` y, en las entradas, solo aceptan
 * `^\d{1,8}(\.\d{1,2})?$` (si no, `RangeError`). Sin redondeos y sin acotar: quien guarda compara con
 * `excedeMontoMaximo`.
 *
 * Fase A: solo las firmas (y `MONTO_MAXIMO`); cada función lanza `Error('No implementado')` hasta la tarea T13.
 */

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
  void precioUnitario;
  void cantidad;
  void cantidadAnulada;
  throw new Error('No implementado');
}

/** Suma de los totales vigentes de los ítems; una orden sin ítems da `"0.00"`. */
export function totalOrden(items: readonly ItemParaTotal[]): string {
  void items;
  throw new Error('No implementado');
}

/** `true` si el monto pasa de `MONTO_MAXIMO` (acepta totales de hasta 12 enteros, como los de `totalOrden`). */
export function excedeMontoMaximo(monto: string): boolean {
  void monto;
  throw new Error('No implementado');
}
