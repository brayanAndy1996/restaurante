/**
 * Ayudas internas de las reglas de caja (historia 006): una copia propia de `Decimal` y los validadores de entrada
 * del criterio 8. No se exportan por la entrada `@restaurante/dominio/caja`.
 */
import Decimal from 'decimal.js';

/**
 * Copia propia de `Decimal`: la configuración (precisión y redondeo) no depende de la que otro código haya fijado
 * en el `Decimal` global. Con 2 decimales en las entradas y cantidades enteras de hasta 999, todo cálculo es exacto.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

/** Mayor cantidad de enteros de un monto de entrada (`^\d{1,8}(\.\d{1,2})?$`). */
export const ENTEROS_MONTO = 8;
/** Mayor cantidad de enteros de un total o de una suma de montos (como los que da `totalOrden`). */
export const ENTEROS_TOTAL = 12;

const FORMATOS = new Map<string, RegExp>();
function formatoDeMonto(enteros: number, conSigno: boolean): RegExp {
  const clave = `${enteros}${conSigno ? '-' : '+'}`;
  let formato = FORMATOS.get(clave);
  if (!formato) {
    formato = new RegExp(`^${conSigno ? '-?' : ''}\\d{1,${enteros}}(\\.\\d{1,2})?$`);
    FORMATOS.set(clave, formato);
  }
  return formato;
}

/** Un monto de entrada: texto decimal con hasta 2 decimales; si no, `RangeError`. */
export function monto(valor: unknown, nombre: string, enteros: number = ENTEROS_MONTO): Dec {
  if (typeof valor !== 'string' || !formatoDeMonto(enteros, false).test(valor)) {
    throw new RangeError(
      `${nombre} no es un monto válido: se esperaba un texto decimal con 2 decimales`,
    );
  }
  return new D(valor);
}

/** Como `monto`, pero admite un signo menos (el esperado de un turno puede ser negativo). */
export function montoConSigno(
  valor: unknown,
  nombre: string,
  enteros: number = ENTEROS_TOTAL,
): Dec {
  if (typeof valor !== 'string' || !formatoDeMonto(enteros, true).test(valor)) {
    throw new RangeError(
      `${nombre} no es un monto válido: se esperaba un texto decimal con 2 decimales`,
    );
  }
  return new D(valor);
}

/** Un entero de `min` a `max`; si no, `RangeError`. */
export function entero(valor: unknown, nombre: string, min: number, max: number): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < min || valor > max) {
    throw new RangeError(`${nombre} debe ser un entero de ${min} a ${max}`);
  }
  return valor;
}

/** Una tasa de IGV en porcentaje, de `"0.01"` a `"30.00"` (criterio 8). */
export function tasa(valor: unknown, nombre: string): Dec {
  if (typeof valor !== 'string' || !/^\d{1,2}(\.\d{1,2})?$/.test(valor)) {
    throw new RangeError(`${nombre} no es una tasa válida: se esperaba un texto de 0.01 a 30.00`);
  }
  const t = new D(valor);
  if (t.lt('0.01') || t.gt('30.00')) {
    throw new RangeError(`${nombre} debe estar entre 0.01 y 30.00`);
  }
  return t;
}

/** Una fecha `AAAA-MM-DD` que existe en el calendario; si no, `RangeError`. */
export function fecha(valor: unknown, nombre: string): string {
  if (typeof valor !== 'string') {
    throw new RangeError(`${nombre} no es una fecha válida: se esperaba AAAA-MM-DD`);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) throw new RangeError(`${nombre} no es una fecha válida: se esperaba AAAA-MM-DD`);
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  // `Date.UTC` trata los años 0 a 99 como 1900 a 1999: se fija el año a mano
  f.setUTCFullYear(anio);
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) {
    throw new RangeError(`${nombre} no existe en el calendario`);
  }
  return valor;
}

/** Un valor de un catálogo (`as const`); si no, `RangeError`. */
export function delCatalogo<T extends string>(
  valor: unknown,
  catalogo: readonly T[],
  nombre: string,
): T {
  if (typeof valor !== 'string' || !(catalogo as readonly string[]).includes(valor)) {
    throw new RangeError(`${nombre} no es válido`);
  }
  return valor as T;
}

/** El texto con 2 decimales (sin el signo de un cero negativo). */
export function dos(x: Dec): string {
  return x.isZero() ? '0.00' : x.toFixed(2);
}

export function suma(valores: readonly Dec[]): Dec {
  return valores.reduce<Dec>((acc, v) => acc.plus(v), new D(0));
}

/** `valor` redondeado a 2 decimales con mitad hacia arriba. */
export function redondear(valor: Dec): Dec {
  return valor.toDecimalPlaces(2, D.ROUND_HALF_UP);
}
