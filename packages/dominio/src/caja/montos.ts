/**
 * Montos de la cuenta (historia 006, criterios 8 a 16; ruta crítica P1). Reciben y devuelven montos como texto
 * decimal con 2 decimales, calculan con `decimal.js` (copia propia) y rechazan con `RangeError` una entrada mal
 * formada.
 */
import { AFECTACIONES_IGV, type AfectacionIgv } from '../carta/catalogos';
import { TIPOS_DESCUENTO, type TipoDescuento } from './catalogos';
import {
  D,
  ENTEROS_TOTAL,
  delCatalogo,
  dos,
  entero,
  monto,
  redondear,
  suma,
  tasa,
  type Dec,
} from './comun';

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

/** Base imponible e IGV de un monto con IGV incluido; `tasaIgv` `null` (Nuevo RUS): sin IGV. */
export function desglosarDec(
  neto: Dec,
  afectacion: AfectacionIgv,
  tasaIgv: Dec | null,
): { base: Dec; igv: Dec } {
  if (tasaIgv === null || afectacion !== 'GRAVADO') return { base: neto, igv: new D(0) };
  const base = redondear(neto.div(tasaIgv.div(100).plus(1)));
  return { base, igv: neto.minus(base) };
}

/**
 * Base imponible e IGV de un monto con IGV incluido (criterio 9). `tasaIgv` `null` (Nuevo RUS): `base` = `neto`
 * e `igv` = `"0.00"`.
 */
export function desglosar(
  neto: string,
  afectacion: AfectacionIgv,
  tasaIgv: string | null,
): Desglose {
  const n = monto(neto, 'El monto');
  const a = delCatalogo(afectacion, AFECTACIONES_IGV, 'La afectación');
  const t = tasaIgv === null ? null : tasa(tasaIgv, 'La tasa de IGV');
  const { base, igv } = desglosarDec(n, a, t);
  return { base: dos(base), igv: dos(igv) };
}

/**
 * Reparto por mayor resto sobre céntimos enteros. `monto` y `pesos` tienen 2 decimales como máximo; con todos los
 * pesos en cero solo se reparte un monto de cero.
 */
export function repartirDec(montoARepartir: Dec, pesos: readonly Dec[]): Dec[] {
  const centimos = montoARepartir.times(100);
  const w = pesos.map((p) => p.times(100));
  if (centimos.isZero()) return w.map(() => new D(0));
  const suma100 = suma(w);
  if (suma100.isZero()) {
    throw new RangeError('No se puede repartir un monto entre pesos que suman cero');
  }
  const productos = w.map((wi) => centimos.times(wi));
  const pisos = productos.map((x) => x.divToInt(suma100));
  const restos = productos.map((x, i) => x.minus(pisos[i]!.times(suma100)));
  const faltan = centimos.minus(suma(pisos)).toNumber();
  const orden = w
    .map((_, i) => i)
    .sort((a, b) => restos[b]!.comparedTo(restos[a]!) || a - b)
    .slice(0, faltan);
  const extra = new Set(orden);
  return pisos.map((p, i) => (extra.has(i) ? p.plus(1) : p).div(100));
}

/**
 * Reparte `monto` entre las `pesos` en proporción a cada una con el método del mayor resto (criterio 13): a cada
 * una le toca el valor truncado al céntimo y los céntimos que faltan van, de a uno, a las de mayor resto (entre
 * restos iguales, a la que va primero). Devuelve un resultado por peso, en el mismo orden; uno de peso `"0.00"` recibe `"0.00"`. La suma es exactamente `monto`.
 */
export function repartirPorMayorResto(montoARepartir: string, pesos: string[]): string[] {
  const m = monto(montoARepartir, 'El monto', ENTEROS_TOTAL);
  if (!Array.isArray(pesos)) throw new RangeError('Los pesos deben ser una lista');
  const w = pesos.map((p) => monto(p, 'El peso', ENTEROS_TOTAL));
  return repartirDec(m, w).map(dos);
}

function leerDescuento(descuento: DescuentoEntrada | null, nombre: string): LeidoDescuento | null {
  if (descuento === null) return null;
  if (typeof descuento !== 'object' || descuento === undefined) {
    throw new RangeError(`${nombre} no es válido`);
  }
  const tipo = delCatalogo(descuento.tipo, TIPOS_DESCUENTO, `El tipo de ${nombre}`);
  return { tipo, valor: monto(descuento.valor, `El valor de ${nombre}`) };
}

interface LeidoDescuento {
  tipo: TipoDescuento;
  valor: Dec;
}

/** El monto de un descuento sobre su base: porcentaje redondeado a la mitad hacia arriba, o el monto tal cual. */
function montoDelDescuento(base: Dec, d: LeidoDescuento): Dec {
  return d.tipo === 'MONTO' ? d.valor : redondear(base.times(d.valor).div(100));
}

/** Valida un descuento sobre su base (criterio 14): devuelve el monto o el motivo del rechazo. */
export function validarDescuento(base: string, descuento: DescuentoEntrada): ResultadoDescuento {
  const b = monto(base, 'La base', ENTEROS_TOTAL);
  const d = leerDescuento(descuento, 'el descuento');
  if (d === null) throw new RangeError('El descuento no es válido');
  // Orden del criterio 14: (1) porcentaje mayor que 99.99, (2) valor en cero, (3) monto, (4) monto en cero,
  // (5) monto mayor o igual que la base.
  if (d.tipo === 'PORCENTAJE' && d.valor.gt('99.99')) {
    return { valido: false, codigo: 'DESCUENTO_EXCESIVO' };
  }
  if (d.valor.isZero()) return { valido: false, codigo: 'DESCUENTO_NULO' };
  const monto2 = montoDelDescuento(b, d);
  if (monto2.isZero()) return { valido: false, codigo: 'DESCUENTO_NULO' };
  if (monto2.gte(b)) return { valido: false, codigo: 'DESCUENTO_EXCESIVO' };
  return { valido: true, monto: dos(monto2) };
}

/** Calcula la cuenta completa: líneas con su desglose y los totales (criterios 11 a 16). */
export function calcularCuenta(cuenta: CuentaEntrada): CuentaCalculada {
  if (typeof cuenta !== 'object' || cuenta === null || !Array.isArray(cuenta.lineas)) {
    throw new RangeError('La cuenta no es válida');
  }
  const tasaIgv = cuenta.tasaIgv === null ? null : tasa(cuenta.tasaIgv, 'La tasa de IGV');
  const montoIcbper = monto(cuenta.montoIcbper, 'El monto del ICBPER');
  const descuentoCuenta = leerDescuento(cuenta.descuentoCuenta, 'el descuento de la cuenta');

  const vistos = new Set<string>();
  const leidas = cuenta.lineas.map((linea, i) => {
    const nombre = `La línea ${i + 1}`;
    if (typeof linea !== 'object' || linea === null) throw new RangeError(`${nombre} no es válida`);
    if (typeof linea.itemId !== 'string' || linea.itemId === '') {
      throw new RangeError(`${nombre} no tiene ítem`);
    }
    if (vistos.has(linea.itemId)) {
      throw new RangeError(`${nombre} repite el ítem ${linea.itemId}`);
    }
    vistos.add(linea.itemId);
    const precio = monto(linea.precioUnitario, `El precio de ${nombre}`);
    const cantidad = entero(linea.cantidad, `La cantidad de ${nombre}`, 1, 999);
    const cortesia = entero(
      linea.cantidadCortesia,
      `La cantidad en cortesía de ${nombre}`,
      0,
      cantidad,
    );
    const afectacion = delCatalogo(
      linea.afectacion,
      AFECTACIONES_IGV,
      `La afectación de ${nombre}`,
    );
    if (typeof linea.aplicaIcbper !== 'boolean') {
      throw new RangeError(`${nombre} no dice si aplica ICBPER`);
    }
    if (linea.aplicaIcbper && cortesia > 0) {
      throw new RangeError(`${nombre} lleva ICBPER y no admite cortesía`);
    }
    const descuento = leerDescuento(linea.descuento, `el descuento de ${nombre}`);
    const cobrable = cantidad - cortesia;
    const bruto = precio.times(cobrable);
    const descuentoItem = descuento === null ? new D(0) : montoDelDescuento(bruto, descuento);
    if (descuentoItem.gt(bruto)) {
      throw new RangeError(`El descuento de ${nombre} es mayor que su importe`);
    }
    return { linea, precio, cortesia, afectacion, cobrable, bruto, descuentoItem };
  });

  // Descuento por cuenta: sobre Σ(bruto − descuentoItem), repartido entre las líneas con bruto > 0
  const pesos = leidas.map((l) => (l.bruto.isZero() ? new D(0) : l.bruto.minus(l.descuentoItem)));
  const baseDescuento = suma(pesos);
  const montoCuenta =
    descuentoCuenta === null ? new D(0) : montoDelDescuento(baseDescuento, descuentoCuenta);
  if (montoCuenta.gt(baseDescuento)) {
    throw new RangeError('El descuento de la cuenta es mayor que su importe');
  }
  const prorrateo = repartirDec(montoCuenta, pesos);

  const lineas = leidas.map((l, i): LineaCalculada => {
    const descuentoDeCuenta = prorrateo[i]!;
    const neto = l.bruto.minus(l.descuentoItem).minus(descuentoDeCuenta);
    const { base, igv } = desglosarDec(neto, l.afectacion, tasaIgv);
    const bolsas = l.linea.aplicaIcbper ? l.cobrable : 0;
    let gratuita: Gratuita | null = null;
    if (l.cortesia > 0) {
      const valorReferencial = l.precio.times(l.cortesia);
      const g = desglosarDec(valorReferencial, l.afectacion, tasaIgv);
      gratuita = {
        cantidad: l.cortesia,
        valorReferencial: dos(valorReferencial),
        base: dos(g.base),
        igv: dos(g.igv),
      };
    }
    return {
      itemId: l.linea.itemId,
      cantidadCobrable: l.cobrable,
      bruto: dos(l.bruto),
      descuentoItem: dos(l.descuentoItem),
      descuentoCuenta: dos(descuentoDeCuenta),
      neto: dos(neto),
      base: dos(base),
      igv: dos(igv),
      bolsas,
      icbper: dos(montoIcbper.times(bolsas)),
      gratuita,
    };
  });

  const porAfectacion = (a: AfectacionIgv): string =>
    dos(suma(lineas.filter((_, i) => leidas[i]!.afectacion === a).map((l) => new D(l.base))));
  const operaciones: OperacionesCuenta | null =
    tasaIgv === null
      ? null
      : {
          gravadas: porAfectacion('GRAVADO'),
          exoneradas: porAfectacion('EXONERADO'),
          inafectas: porAfectacion('INAFECTO'),
          gratuitas: dos(suma(lineas.map((l) => new D(l.gratuita?.base ?? 0)))),
        };
  const sumaDe = (campo: (l: LineaCalculada) => string): Dec =>
    suma(lineas.map((l) => new D(campo(l))));
  const totales: TotalesCuenta = {
    subtotal: dos(sumaDe((l) => l.bruto)),
    descuentos: dos(sumaDe((l) => l.descuentoItem).plus(sumaDe((l) => l.descuentoCuenta))),
    operaciones,
    igv: dos(sumaDe((l) => l.igv)),
    igvGratuitas: dos(suma(lineas.map((l) => new D(l.gratuita?.igv ?? 0)))),
    icbper: dos(sumaDe((l) => l.icbper)),
    total: dos(sumaDe((l) => l.neto).plus(sumaDe((l) => l.icbper))),
  };
  return { lineas, totales };
}
