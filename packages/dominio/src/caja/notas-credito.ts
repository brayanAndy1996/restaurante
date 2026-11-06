/**
 * Notas de crédito (historia 006, entrega 6b, criterios 143 a 148; ruta crítica P8): lo que acredita una anulación o
 * una devolución por ítem de un comprobante, con los montos de `packages/dominio` (texto con 2 decimales, `decimal.js`).
 *
 * Los montos de entrada tienen exactamente 2 decimales (`"56.00"`; `"56"` y `"56.0"` son `RangeError`).
 */
import { AFECTACIONES_IGV, type AfectacionIgv } from '../carta/catalogos';
import { D, delCatalogo, dos, entero, redondear, suma, tasa, type Dec } from './comun';
import { desglosarDec, type TotalesCuenta } from './montos';

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
  /** La base ya acreditada: hace falta para cerrar exactamente la última devolución (criterio 147). */
  base: string;
  /** El IGV ya acreditado. */
  igv: string;
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

// ------------------------------------------------------------------------------------------------
// Lectura de la entrada (RangeError con una entrada mal formada, criterio 8)
// ------------------------------------------------------------------------------------------------

/** Un monto de la nota: texto con exactamente 2 decimales y hasta 8 enteros. */
function montoNota(valor: unknown, nombre: string): Dec {
  if (typeof valor !== 'string' || !/^\d{1,8}\.\d{2}$/.test(valor)) {
    throw new RangeError(
      `${nombre} no es un monto válido: se esperaba un texto decimal con 2 decimales`,
    );
  }
  return new D(valor);
}

interface LineaLeida {
  entrada: LineaOriginalDeNota;
  posicion: number;
  cantidad: number;
  precio: Dec;
  afectacion: AfectacionIgv;
  bruto: Dec;
  descuento: Dec;
  neto: Dec;
  base: Dec;
  igv: Dec;
  bolsas: number;
  icbper: Dec;
  gratuita: boolean;
  valorReferencial: Dec | null;
  baseReferencial: Dec | null;
  igvReferencial: Dec | null;
}

function objeto(valor: unknown, nombre: string): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new RangeError(`${nombre} no es válido`);
  }
  return valor as Record<string, unknown>;
}

function leerOriginal(original: unknown): { tasaIgv: Dec | null; lineas: LineaLeida[] } {
  const o = objeto(original, 'El comprobante original');
  if (!Array.isArray(o.lineas)) throw new RangeError('Las líneas del original deben ser una lista');
  const tasaIgv = o.tasaIgv === null ? null : tasa(o.tasaIgv, 'La tasa de IGV');
  const vistas = new Set<number>();
  const lineas = (o.lineas as unknown[]).map((crudo, i): LineaLeida => {
    const nombre = `La línea ${i + 1} del original`;
    const l = objeto(crudo, nombre);
    const posicion = entero(l.posicion, `La posición de ${nombre}`, 1, 9999);
    if (vistas.has(posicion)) throw new RangeError(`${nombre} repite la posición ${posicion}`);
    vistas.add(posicion);
    if (typeof l.gratuita !== 'boolean') throw new RangeError(`${nombre} no dice si es gratuita`);
    const gratuita = l.gratuita;
    const referencial = (valor: unknown, campo: string): Dec | null =>
      gratuita ? montoNota(valor, `El ${campo} de ${nombre}`) : null;
    return {
      entrada: l as unknown as LineaOriginalDeNota,
      posicion,
      cantidad: entero(l.cantidad, `La cantidad de ${nombre}`, 1, 999),
      precio: montoNota(l.precioUnitario, `El precio de ${nombre}`),
      afectacion: delCatalogo(l.afectacion, AFECTACIONES_IGV, `La afectación de ${nombre}`),
      bruto: montoNota(l.bruto, `El bruto de ${nombre}`),
      descuento: montoNota(l.descuento, `El descuento de ${nombre}`),
      neto: montoNota(l.neto, `El neto de ${nombre}`),
      base: montoNota(l.base, `La base de ${nombre}`),
      igv: montoNota(l.igv, `El IGV de ${nombre}`),
      bolsas: entero(l.bolsas, `Las bolsas de ${nombre}`, 0, 999),
      icbper: montoNota(l.icbper, `El ICBPER de ${nombre}`),
      gratuita,
      valorReferencial: referencial(l.valorReferencial, 'valor referencial'),
      baseReferencial: referencial(l.baseReferencial, 'base referencial'),
      igvReferencial: referencial(l.igvReferencial, 'IGV referencial'),
    };
  });
  return { tasaIgv, lineas };
}

/** Lo ya acreditado de una línea del original. */
interface Acreditado {
  cantidad: number;
  neto: Dec;
  base: Dec;
  igv: Dec;
  bolsas: number;
  icbper: Dec;
}

function leerAcreditadas(
  acreditadas: unknown,
  posiciones: ReadonlySet<number>,
): Map<number, Acreditado> {
  if (!Array.isArray(acreditadas)) throw new RangeError('Lo acreditado debe ser una lista');
  const porLinea = new Map<number, Acreditado>();
  for (const [i, crudo] of (acreditadas as unknown[]).entries()) {
    const nombre = `La línea acreditada ${i + 1}`;
    const a = objeto(crudo, nombre);
    const posicionOrigen = entero(a.posicionOrigen, `La posición de origen de ${nombre}`, 1, 9999);
    if (!posiciones.has(posicionOrigen)) {
      throw new RangeError(`${nombre} acredita la posición ${posicionOrigen}, que no existe`);
    }
    const previo = porLinea.get(posicionOrigen) ?? {
      cantidad: 0,
      neto: new D(0),
      base: new D(0),
      igv: new D(0),
      bolsas: 0,
      icbper: new D(0),
    };
    porLinea.set(posicionOrigen, {
      cantidad: previo.cantidad + entero(a.cantidad, `La cantidad de ${nombre}`, 1, 999),
      neto: previo.neto.plus(montoNota(a.neto, `El neto de ${nombre}`)),
      base: previo.base.plus(montoNota(a.base, `La base de ${nombre}`)),
      igv: previo.igv.plus(montoNota(a.igv, `El IGV de ${nombre}`)),
      bolsas: previo.bolsas + entero(a.bolsas, `Las bolsas de ${nombre}`, 0, 999),
      icbper: previo.icbper.plus(montoNota(a.icbper, `El ICBPER de ${nombre}`)),
    });
  }
  return porLinea;
}

type PedidoLeido =
  { tipo: 'ANULACION' } | { tipo: 'DEVOLUCION'; lineas: { posicion: number; cantidad: number }[] };

function leerPedido(pedido: unknown): PedidoLeido {
  const p = objeto(pedido, 'El pedido');
  if (p.tipo === 'ANULACION') return { tipo: 'ANULACION' };
  if (p.tipo !== 'DEVOLUCION') throw new RangeError('El tipo del pedido no es válido');
  if (!Array.isArray(p.lineas)) throw new RangeError('Las líneas del pedido deben ser una lista');
  return {
    tipo: 'DEVOLUCION',
    lineas: (p.lineas as unknown[]).map((crudo, i) => {
      const nombre = `La línea ${i + 1} del pedido`;
      const l = objeto(crudo, nombre);
      return {
        posicion: entero(l.posicion, `La posición de ${nombre}`, 1, 9999),
        cantidad: entero(l.cantidad, `La cantidad de ${nombre}`, 1, 999),
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------------
// Cálculo
// ------------------------------------------------------------------------------------------------

const max0 = (x: Dec): Dec => (x.isNegative() ? new D(0) : x);

function totalesDe(
  tasaIgv: Dec | null,
  calculadas: readonly LineaDeNotaCalculada[],
): TotalesCuenta {
  const sumaDe = (campo: (l: LineaDeNotaCalculada) => string): Dec =>
    suma(calculadas.map((l) => new D(campo(l))));
  const porAfectacion = (a: AfectacionIgv): string =>
    dos(
      suma(calculadas.filter((l) => l.afectacion === a && !l.gratuita).map((l) => new D(l.base))),
    );
  return {
    subtotal: dos(sumaDe((l) => l.bruto)),
    descuentos: dos(sumaDe((l) => l.descuento)),
    operaciones:
      tasaIgv === null
        ? null
        : {
            gravadas: porAfectacion('GRAVADO'),
            exoneradas: porAfectacion('EXONERADO'),
            inafectas: porAfectacion('INAFECTO'),
            gratuitas: dos(suma(calculadas.map((l) => new D(l.baseReferencial ?? 0)))),
          },
    igv: dos(sumaDe((l) => l.igv)),
    igvGratuitas: dos(suma(calculadas.map((l) => new D(l.igvReferencial ?? 0)))),
    icbper: dos(sumaDe((l) => l.icbper)),
    total: dos(sumaDe((l) => l.neto).plus(sumaDe((l) => l.icbper))),
  };
}

/** La línea del original tal cual (la anulación). */
function lineaTalCual(l: LineaLeida, posicion: number): LineaDeNotaCalculada {
  return {
    posicion,
    posicionOrigen: l.posicion,
    cantidad: l.cantidad,
    precioUnitario: dos(l.precio),
    afectacion: l.afectacion,
    bruto: dos(l.bruto),
    descuento: dos(l.descuento),
    neto: dos(l.neto),
    base: dos(l.base),
    igv: dos(l.igv),
    bolsas: l.bolsas,
    icbper: dos(l.icbper),
    gratuita: l.gratuita,
    valorReferencial: l.valorReferencial === null ? null : dos(l.valorReferencial),
    baseReferencial: l.baseReferencial === null ? null : dos(l.baseReferencial),
    igvReferencial: l.igvReferencial === null ? null : dos(l.igvReferencial),
  };
}

/** `q` unidades de una línea a la que le faltan `n` (criterio 147). */
function lineaDevuelta(
  l: LineaLeida,
  falta: { cantidad: number; neto: Dec; base: Dec; igv: Dec; icbper: Dec },
  q: number,
  tasaIgv: Dec | null,
  posicion: number,
): LineaDeNotaCalculada {
  const n = falta.cantidad;
  const todo = q === n;
  const proporcional = (x: Dec): Dec => (todo ? x : redondear(x.times(q).div(n)));
  const neto = proporcional(falta.neto);
  const bruto = l.precio.times(q);

  let base: Dec;
  let igv: Dec;
  if (todo) {
    base = falta.base;
    igv = falta.igv;
  } else {
    ({ base, igv } = desglosarDec(neto, l.afectacion, tasaIgv));
    // Sin pasar de lo que falta de base ni de IGV: el resto va al otro componente (base + IGV = neto)
    if (igv.gt(falta.igv)) {
      igv = falta.igv;
      base = neto.minus(igv);
    } else if (base.gt(falta.base)) {
      base = falta.base;
      igv = neto.minus(base);
    }
  }
  return {
    posicion,
    posicionOrigen: l.posicion,
    cantidad: q,
    precioUnitario: dos(l.precio),
    afectacion: l.afectacion,
    bruto: dos(bruto),
    descuento: dos(bruto.minus(neto)),
    neto: dos(neto),
    base: dos(base),
    igv: dos(igv),
    bolsas: l.bolsas > 0 ? q : 0,
    icbper: dos(proporcional(falta.icbper)),
    gratuita: false,
    valorReferencial: null,
    baseReferencial: null,
    igvReferencial: null,
  };
}

/**
 * Calcula la nota de crédito de un comprobante (criterio 147). Devuelve `{ valida: true, lineas, totales }` o
 * `{ valida: false, codigo }` y lanza `RangeError` con una entrada mal formada.
 *
 * Devolución: una posición inexistente o repetida, una línea gratuita, un pedido sin líneas o más unidades de las que
 * faltan dan `NOTA_CREDITO_INVALIDA`; una línea a la que no le falta nada, `NADA_QUE_ACREDITAR` (si el pedido tiene
 * de las dos clases, manda `NOTA_CREDITO_INVALIDA`).
 */
export function calcularNotaCredito(
  original: OriginalDeNota,
  acreditadas: readonly LineaAcreditada[],
  pedido: PedidoDeNota,
): ResultadoNotaCredito {
  const { tasaIgv, lineas } = leerOriginal(original);
  const previas = leerAcreditadas(acreditadas, new Set(lineas.map((l) => l.posicion)));
  const p = leerPedido(pedido);
  const invalida = { valida: false, codigo: 'NOTA_CREDITO_INVALIDA' } as const;

  let calculadas: LineaDeNotaCalculada[];
  if (p.tipo === 'ANULACION') {
    if (previas.size > 0) return invalida;
    calculadas = [...lineas]
      .sort((a, b) => a.posicion - b.posicion)
      .map((l, i) => lineaTalCual(l, i + 1));
  } else {
    if (p.lineas.length === 0) return invalida;
    const pedidas = new Map<number, number>();
    for (const l of p.lineas) {
      if (pedidas.has(l.posicion)) return invalida;
      pedidas.set(l.posicion, l.cantidad);
    }
    const elegidas = [...pedidas.keys()]
      .sort((a, b) => a - b)
      .map((posicion) => lineas.find((l) => l.posicion === posicion));
    if (elegidas.some((l) => l === undefined || l.gratuita)) return invalida;

    const calculos: Array<{
      l: LineaLeida;
      q: number;
      falta: Parameters<typeof lineaDevuelta>[1];
    }> = [];
    let nadaQueAcreditar = false;
    let masDeLasQueFaltan = false;
    for (const l of elegidas as LineaLeida[]) {
      const q = pedidas.get(l.posicion)!;
      const a = previas.get(l.posicion);
      const falta = {
        cantidad: l.cantidad - (a?.cantidad ?? 0),
        neto: max0(l.neto.minus(a?.neto ?? 0)),
        base: max0(l.base.minus(a?.base ?? 0)),
        igv: max0(l.igv.minus(a?.igv ?? 0)),
        icbper: max0(l.icbper.minus(a?.icbper ?? 0)),
      };
      if (falta.cantidad <= 0) nadaQueAcreditar = true;
      else if (q > falta.cantidad) masDeLasQueFaltan = true;
      else calculos.push({ l, q, falta });
    }
    if (masDeLasQueFaltan) return invalida;
    if (nadaQueAcreditar) return { valida: false, codigo: 'NADA_QUE_ACREDITAR' };
    calculadas = calculos.map(({ l, q, falta }, i) => lineaDevuelta(l, falta, q, tasaIgv, i + 1));
  }
  return { valida: true, lineas: calculadas, totales: totalesDe(tasaIgv, calculadas) };
}
