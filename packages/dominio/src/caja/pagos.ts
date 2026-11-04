/** Pagos, vuelto y redondeo del efectivo (historia 006, criterio 21; ruta crítica P1). */
import { MEDIOS_PAGO, type MedioPago } from './catalogos';
import { D, ENTEROS_TOTAL, delCatalogo, dos, monto, suma, type Dec } from './comun';

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

/** Lo que queda por cobrar tras los pagos no en efectivo, truncado a la décima y su resto. */
function redondearEfectivo(resto: Dec): { efectivo: Dec; redondeo: Dec } {
  const efectivo = resto.toDecimalPlaces(1, D.ROUND_DOWN);
  return { efectivo, redondeo: resto.minus(efectivo) };
}

/**
 * Valida los pagos contra el total y el redondeo, y calcula el vuelto (criterio 21). `redondeo` debe ser exactamente
 * el de `redondeoEfectivo`: sin pago en `EFECTIVO`, `"0.00"` (el redondeo solo se aplica a la parte en efectivo).
 */
export function validarPagos(
  total: string,
  pagos: readonly PagoEntrada[],
  redondeo: string,
): ResultadoPagos {
  const t = monto(total, 'El total', ENTEROS_TOTAL);
  const r = monto(redondeo, 'El redondeo');
  if (!Array.isArray(pagos)) throw new RangeError('Los pagos deben ser una lista');
  const leidos = pagos.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new RangeError(`El pago ${i + 1} no es válido`);
    return {
      medio: delCatalogo(p.medio, MEDIOS_PAGO, `El medio del pago ${i + 1}`),
      monto: monto(p.monto, `El monto del pago ${i + 1}`),
      recibido:
        p.recibido === undefined ? undefined : monto(p.recibido, `El recibido del pago ${i + 1}`),
    };
  });
  const noCuadra = { valido: false, codigo: 'PAGOS_NO_CUADRAN' } as const;

  if (leidos.some((p) => !p.monto.gt(0))) return noCuadra;
  const efectivos = leidos.filter((p) => p.medio === 'EFECTIVO');
  if (efectivos.length > 1) return noCuadra;
  // Solo el efectivo da vuelto: `recibido` en otro medio no vale
  if (leidos.some((p) => p.medio !== 'EFECTIVO' && p.recibido !== undefined)) return noCuadra;
  const efectivo = efectivos[0];
  if (efectivo?.recibido !== undefined && efectivo.recibido.lt(efectivo.monto)) return noCuadra;

  // El redondeo es el de `redondeoEfectivo`, y solo existe si hay un pago en efectivo
  const noEfectivo = suma(leidos.filter((p) => p.medio !== 'EFECTIVO').map((p) => p.monto));
  const resto = t.minus(noEfectivo);
  if (resto.lt(0)) return noCuadra;
  const esperado = efectivo === undefined ? new D(0) : redondearEfectivo(resto).redondeo;
  if (!r.eq(esperado)) return noCuadra;

  if (
    !suma(leidos.map((p) => p.monto))
      .plus(r)
      .eq(t)
  )
    return noCuadra;

  const vuelto =
    efectivo === undefined ? new D(0) : (efectivo.recibido ?? efectivo.monto).minus(efectivo.monto);
  return { valido: true, vuelto: dos(vuelto) };
}

/**
 * El efectivo y el redondeo que corresponden a un total pagado en parte con otros medios (criterio 21): con efectivo,
 * `efectivo` = total menos los otros pagos y `redondeo` = lo que pasa de la décima; sin efectivo, `"0.00"`.
 */
export function redondeoEfectivo(
  total: string,
  pagosNoEfectivo: readonly { monto: string }[],
): RedondeoEfectivo {
  const t = monto(total, 'El total', ENTEROS_TOTAL);
  if (!Array.isArray(pagosNoEfectivo)) throw new RangeError('Los pagos deben ser una lista');
  const otros = pagosNoEfectivo.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new RangeError(`El pago ${i + 1} no es válido`);
    return monto(p.monto, `El monto del pago ${i + 1}`);
  });
  const resto = t.minus(suma(otros));
  if (resto.lt(0)) {
    throw new RangeError('Los pagos que no son en efectivo superan el total');
  }
  const { efectivo, redondeo } = redondearEfectivo(resto);
  return { efectivo: dos(efectivo), redondeo: dos(redondeo) };
}
