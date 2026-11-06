/** Esperado y arqueo del turno (historia 006, criterio 22; ruta crítica P1). */
import {
  MEDIOS_PAGO,
  TIPOS_MOVIMIENTO_CAJA,
  type MedioPago,
  type TipoMovimientoCaja,
} from './catalogos';
import { D, delCatalogo, dos, monto, montoConSigno, suma, type Dec } from './comun';

export interface MontoPorMedio {
  medio: MedioPago;
  monto: string;
}

export interface EntradaEsperadoDelTurno {
  fondo: string;
  /** Los pagos confirmados del turno (lo que quedó en la gaveta, sin el vuelto). */
  pagos: readonly MontoPorMedio[];
  /** Los ingresos y egresos de efectivo del turno. */
  movimientos: readonly {
    tipo: TipoMovimientoCaja;
    monto: string;
    /**
     * El medio del movimiento (6b, criterio 136): sin él, `EFECTIVO`. En la fase A todavía no cambia el cálculo: el
     * esperado sigue tratando todos los movimientos como de efectivo.
     */
    medio?: MedioPago;
  }[];
}

export interface DiferenciaDelArqueo {
  medio: MedioPago;
  esperado: string;
  contado: string;
  /** `contado` menos `esperado`. */
  diferencia: string;
}

function lista<T>(valor: readonly T[], nombre: string): readonly T[] {
  if (!Array.isArray(valor)) throw new RangeError(`${nombre} debe ser una lista`);
  return valor;
}

/** El esperado de los cinco medios, en el orden de `MEDIOS_PAGO` (criterio 22). */
export function esperadoDelTurno(entrada: EntradaEsperadoDelTurno): MontoPorMedio[] {
  if (typeof entrada !== 'object' || entrada === null) {
    throw new RangeError('La entrada no es válida');
  }
  const fondo = monto(entrada.fondo, 'El fondo');
  const pagos = lista(entrada.pagos, 'Los pagos').map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new RangeError(`El pago ${i + 1} no es válido`);
    return {
      medio: delCatalogo(p.medio, MEDIOS_PAGO, `El medio del pago ${i + 1}`),
      monto: monto(p.monto, `El monto del pago ${i + 1}`),
    };
  });
  const movimientos = lista(entrada.movimientos, 'Los movimientos').map((m, i) => {
    if (typeof m !== 'object' || m === null) {
      throw new RangeError(`El movimiento ${i + 1} no es válido`);
    }
    return {
      tipo: delCatalogo(m.tipo, TIPOS_MOVIMIENTO_CAJA, `El tipo del movimiento ${i + 1}`),
      monto: monto(m.monto, `El monto del movimiento ${i + 1}`),
    };
  });
  const delMedio = (medio: MedioPago): Dec =>
    suma(pagos.filter((p) => p.medio === medio).map((p) => p.monto));
  const ingresos = suma(movimientos.filter((m) => m.tipo === 'INGRESO').map((m) => m.monto));
  const egresos = suma(movimientos.filter((m) => m.tipo === 'EGRESO').map((m) => m.monto));
  return MEDIOS_PAGO.map((medio) => ({
    medio,
    monto: dos(
      medio === 'EFECTIVO'
        ? fondo.plus(delMedio(medio)).plus(ingresos).minus(egresos)
        : delMedio(medio),
    ),
  }));
}

/** Los montos de un medio cada uno, una sola vez; un medio ausente vale cero. */
function porMedio(
  valores: readonly MontoPorMedio[],
  nombre: string,
  leer: (valor: unknown, nombre: string) => Dec,
): Map<MedioPago, Dec> {
  const resultado = new Map<MedioPago, Dec>();
  for (const [i, v] of lista(valores, nombre).entries()) {
    if (typeof v !== 'object' || v === null)
      throw new RangeError(`${nombre}: ${i + 1} no es válido`);
    const medio = delCatalogo(v.medio, MEDIOS_PAGO, `El medio de ${nombre} ${i + 1}`);
    if (resultado.has(medio)) throw new RangeError(`${nombre} repite el medio ${medio}`);
    resultado.set(medio, leer(v.monto, `El monto de ${nombre} ${i + 1}`));
  }
  return resultado;
}

/** Por medio, `contado − esperado` (criterio 22). */
export function diferenciasDelArqueo(
  esperado: readonly MontoPorMedio[],
  contado: readonly MontoPorMedio[],
): DiferenciaDelArqueo[] {
  // El esperado puede ser negativo (egresos mayores que los ingresos)
  const e = porMedio(esperado, 'El esperado', montoConSigno);
  const c = porMedio(contado, 'El contado', (v, n) => monto(v, n, 12));
  return MEDIOS_PAGO.map((medio) => {
    const esperadoDelMedio = e.get(medio) ?? new D(0);
    const contadoDelMedio = c.get(medio) ?? new D(0);
    return {
      medio,
      esperado: dos(esperadoDelMedio),
      contado: dos(contadoDelMedio),
      diferencia: dos(contadoDelMedio.minus(esperadoDelMedio)),
    };
  });
}
