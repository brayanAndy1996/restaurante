/** Esperado y arqueo del turno (historia 006, criterio 22; ruta crítica P1). FIRMAS de la fase A. */
import type { MedioPago, TipoMovimientoCaja } from './catalogos';

export interface MontoPorMedio {
  medio: MedioPago;
  monto: string;
}

export interface EntradaEsperadoDelTurno {
  fondo: string;
  /** Los pagos confirmados del turno (lo que quedó en la gaveta, sin el vuelto). */
  pagos: readonly MontoPorMedio[];
  /** Los ingresos y egresos de efectivo del turno. */
  movimientos: readonly { tipo: TipoMovimientoCaja; monto: string }[];
}

export interface DiferenciaDelArqueo {
  medio: MedioPago;
  esperado: string;
  contado: string;
  /** `contado` menos `esperado`. */
  diferencia: string;
}

/** El esperado de los cinco medios, en el orden de `MEDIOS_PAGO` (criterio 22). */
export function esperadoDelTurno(_entrada: EntradaEsperadoDelTurno): MontoPorMedio[] {
  throw new Error('No implementado');
}

/** Por medio, `contado − esperado` (criterio 22). */
export function diferenciasDelArqueo(
  _esperado: readonly MontoPorMedio[],
  _contado: readonly MontoPorMedio[],
): DiferenciaDelArqueo[] {
  throw new Error('No implementado');
}
