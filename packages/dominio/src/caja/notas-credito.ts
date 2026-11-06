/**
 * Notas de crédito (historia 006, entrega 6b, criterios 143 a 148; ruta crítica P8): lo que acredita una anulación o
 * una devolución por ítem de un comprobante, con los montos de `packages/dominio` (texto con 2 decimales, `decimal.js`).
 *
 * Fase A (T28): solo los tipos y la firma; `calcularNotaCredito` lanza `Error('No implementado')` hasta T39.
 */
import type { AfectacionIgv } from '../carta/catalogos';
import type { TotalesCuenta } from './montos';

/** Una línea del comprobante original, tal como la guardó la facturación (criterio 69). */
export interface LineaOriginalDeNota {
  posicion: number;
  cantidad: number;
  precioUnitario: string;
  afectacion: AfectacionIgv;
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  gratuita: boolean;
  /** Solo en una línea gratuita: lo que habría valido (se copia tal cual en la anulación). */
  valorReferencial?: string | null;
  baseReferencial?: string | null;
  igvReferencial?: string | null;
}

/** El comprobante que se acredita. */
export interface OriginalDeNota {
  /** La tasa de IGV con la que se emitió; `null` con un emisor Nuevo RUS. */
  tasaIgv: string | null;
  lineas: readonly LineaOriginalDeNota[];
}

/** Lo que ya acreditaron las notas de crédito que cuentan (criterio 148), por línea del original. */
export interface LineaAcreditada {
  posicionOrigen: number;
  cantidad: number;
  neto: string;
  bolsas: number;
  icbper: string;
}

export type PedidoDeNota =
  | { tipo: 'ANULACION' }
  | { tipo: 'DEVOLUCION'; lineas: readonly { posicion: number; cantidad: number }[] };

/** Una línea de la nota: lo que acredita de una línea del original. */
export interface LineaDeNotaCalculada {
  posicion: number;
  /** La `posicion` de la línea del original que acredita. */
  posicionOrigen: number;
  cantidad: number;
  precioUnitario: string;
  afectacion: AfectacionIgv;
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  gratuita: boolean;
  valorReferencial: string | null;
  baseReferencial: string | null;
  igvReferencial: string | null;
}

export type ResultadoNotaCredito =
  | { valida: true; lineas: LineaDeNotaCalculada[]; totales: TotalesCuenta }
  | { valida: false; codigo: 'NOTA_CREDITO_INVALIDA' | 'NADA_QUE_ACREDITAR' };

/**
 * Calcula la nota de crédito de un comprobante (criterio 147). Devuelve `{ valida: true, lineas, totales }` o
 * `{ valida: false, codigo }` y lanza `RangeError` con una entrada mal formada.
 */
export function calcularNotaCredito(
  original: OriginalDeNota,
  acreditadas: readonly LineaAcreditada[],
  pedido: PedidoDeNota,
): ResultadoNotaCredito {
  void original;
  void acreditadas;
  void pedido;
  throw new Error('No implementado');
}
