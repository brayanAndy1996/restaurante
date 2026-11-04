/** Pagos, vuelto y redondeo del efectivo (historia 006, criterio 21; ruta crítica P1). FIRMAS de la fase A. */
import type { MedioPago } from './catalogos';

export interface PagoEntrada {
  medio: MedioPago;
  monto: string;
  /** Solo en `EFECTIVO` y mayor o igual que `monto`; si falta, vale el `monto`. */
  recibido?: string;
}

export type ResultadoPagos =
  { valido: true; vuelto: string } | { valido: false; codigo: 'PAGOS_NO_CUADRAN' };

export interface RedondeoEfectivo {
  /** Lo que se cobra en efectivo (total menos los pagos no en efectivo). */
  efectivo: string;
  /** Lo que se deja de cobrar para llegar a la décima de sol, a favor del cliente (0.00 a 0.09). */
  redondeo: string;
}

/**
 * Valida los pagos contra el total y el redondeo, y calcula el vuelto (criterio 21). `redondeo` debe ser exactamente
 * el de `redondeoEfectivo`: sin pago en `EFECTIVO`, `"0.00"` (el redondeo solo se aplica a la parte en efectivo).
 */
export function validarPagos(
  _total: string,
  _pagos: readonly PagoEntrada[],
  _redondeo: string,
): ResultadoPagos {
  throw new Error('No implementado');
}

/**
 * El efectivo y el redondeo que corresponden a un total pagado en parte con otros medios (criterio 21): con efectivo,
 * `efectivo` = total menos los otros pagos y `redondeo` = lo que pasa de la décima; sin efectivo, `"0.00"`.
 */
export function redondeoEfectivo(
  _total: string,
  _pagosNoEfectivo: readonly { monto: string }[],
): RedondeoEfectivo {
  throw new Error('No implementado');
}
