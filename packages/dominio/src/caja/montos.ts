/**
 * Montos de la cuenta (historia 006, criterios 8 a 16; ruta crítica P1). Reciben y devuelven montos como texto
 * decimal con 2 decimales, calculan con `decimal.js` (copia propia) y rechazan con `RangeError` una entrada mal
 * formada. FIRMAS de la fase A: todavía no hacen nada (cada tarea de la fase C reemplaza el `throw`).
 */
import type { AfectacionIgv } from '../carta';
import type { TipoDescuento } from './catalogos';

/** Un descuento tal como lo escribe la persona: porcentaje (`"10"`) o monto (`"5.00"`). */
export interface DescuentoEntrada {
  tipo: TipoDescuento;
  valor: string;
}

/** Una línea de la cuenta (un ítem con su cantidad vigente). */
export interface LineaDeCuentaEntrada {
  itemId: string;
  precioUnitario: string;
  /** La cantidad vigente, de 1 a 999. */
  cantidad: number;
  /** Unidades en cortesía, de 0 a `cantidad`. */
  cantidadCortesia: number;
  afectacion: AfectacionIgv;
  aplicaIcbper: boolean;
  descuento: DescuentoEntrada | null;
}

/** Entrada de `calcularCuenta`, `calcularParte` y `cambioDeCuentaPermitido`. */
export interface CuentaEntrada {
  lineas: readonly LineaDeCuentaEntrada[];
  descuentoCuenta: DescuentoEntrada | null;
  /** Tasa de IGV vigente en porcentaje (`"18.00"`); `null` para un emisor `NUEVO_RUS` (criterio 16). */
  tasaIgv: string | null;
  /** Monto del ICBPER por bolsa vigente. */
  montoIcbper: string;
}

/** Las unidades de una línea que se dan en cortesía: operación gratuita (criterio 15). */
export interface Gratuita {
  cantidad: number;
  valorReferencial: string;
  base: string;
  igv: string;
}

export interface LineaCalculada {
  itemId: string;
  cantidadCobrable: number;
  bruto: string;
  descuentoItem: string;
  descuentoCuenta: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  gratuita: Gratuita | null;
}

export interface OperacionesCuenta {
  gravadas: string;
  exoneradas: string;
  inafectas: string;
  gratuitas: string;
}

export interface TotalesCuenta {
  subtotal: string;
  descuentos: string;
  /** `null` con un emisor Nuevo RUS (criterio 16). */
  operaciones: OperacionesCuenta | null;
  igv: string;
  igvGratuitas: string;
  icbper: string;
  total: string;
}

export interface CuentaCalculada {
  lineas: LineaCalculada[];
  totales: TotalesCuenta;
}

export interface Desglose {
  base: string;
  igv: string;
}

export type ResultadoDescuento =
  | { valido: true; monto: string }
  | { valido: false; codigo: 'DESCUENTO_EXCESIVO' | 'DESCUENTO_NULO' };

/**
 * Base imponible e IGV de un monto con IGV incluido (criterio 9). `tasaIgv` `null` (Nuevo RUS): `base` = `neto`
 * e `igv` = `"0.00"`.
 */
export function desglosar(
  _neto: string,
  _afectacion: AfectacionIgv,
  _tasaIgv: string | null,
): Desglose {
  throw new Error('No implementado');
}

/**
 * Reparte `monto` entre las `pesos` en proporción a cada una con el método del mayor resto (criterio 13): a cada
 * una le toca el valor truncado al céntimo y los céntimos que faltan van, de a uno, a las de mayor resto (entre
 * restos iguales, a la que va primero). Una de peso `"0.00"` recibe `"0.00"`. La suma es exactamente `monto`.
 */
export function repartirPorMayorResto(_monto: string, _pesos: readonly string[]): string[] {
  throw new Error('No implementado');
}

/** Valida un descuento sobre su base (criterio 14): devuelve el monto o el motivo del rechazo. */
export function validarDescuento(_base: string, _descuento: DescuentoEntrada): ResultadoDescuento {
  throw new Error('No implementado');
}

/** Calcula la cuenta completa: líneas con su desglose y los totales (criterios 11 a 16). */
export function calcularCuenta(_cuenta: CuentaEntrada): CuentaCalculada {
  throw new Error('No implementado');
}
