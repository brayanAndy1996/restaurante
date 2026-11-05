/**
 * División de la cuenta (historia 006, criterios 17 a 20; ruta crítica P1). `cuenta` es la entrada de
 * `calcularCuenta` (las funciones la calculan por dentro) y `partesAnteriores` son las partes ya cobradas tal como
 * las devolvió `calcularParte`: la API las guarda en `cobro.detalle_parte`.
 */
import { AFECTACIONES_IGV, type AfectacionIgv } from '../carta/catalogos';
import {
  FORMATOS_COMPROBANTE,
  TIPOS_PARTE,
  type FormatoComprobante,
  type TipoParte,
} from './catalogos';
import {
  D,
  ENTEROS_TOTAL,
  delCatalogo,
  dos,
  entero,
  monto,
  redondear,
  suma,
  type Dec,
} from './comun';
import {
  calcularCuenta,
  desglosarDec,
  repartirDec,
  type CuentaCalculada,
  type CuentaEntrada,
  type Gratuita,
  type TotalesCuenta,
} from './montos';

/** Qué se cobra ahora. `items`: de 1 a 200, `cantidad` de 1 a 999; `partesRestantes`: de 1 a 50. */
export type ParteEntrada =
  | { tipo: 'TOTAL' }
  | { tipo: 'ITEMS'; items: readonly { itemId: string; cantidad: number }[] }
  | { tipo: 'IGUALES'; partesRestantes: number };

/** Una línea del comprobante de una parte. En el formato `CONSUMO`, las líneas agrupadas no tienen `itemId`. */
export interface LineaDeParte {
  /** `null` en las líneas "Por consumo" (una por afectación). */
  itemId: string | null;
  /** Unidades que cubre la línea; en las líneas por consumo, `1`. */
  cantidad: number;
  afectacion: AfectacionIgv;
  bruto: string;
  descuento: string;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
  gratuita: Gratuita | null;
}

/**
 * Lo que una parte toma de un ítem de la cuenta (criterio 17): las unidades cobrables, el neto y las bolsas. Hace falta
 * aparte de `lineas` porque en el formato `CONSUMO` las líneas agrupadas no dicen el ítem.
 */
export interface ItemDeParte {
  itemId: string;
  cantidad: number;
  neto: string;
  bolsas: number;
}

/**
 * Una parte válida: `lineas` es el detalle del comprobante, `porItem` lo que la parte toma de cada ítem (en
 * `IGUALES`, solo las líneas de ICBPER), `totales` los de la parte y `cierraLaCuenta` si con ella no falta nada.
 * Facturación la guarda en `comprobante.detalle_parte` (criterio 69) y es la `partesAnteriores` de las siguientes.
 */
export interface ParteCalculada {
  tipo: TipoParte;
  formato: FormatoComprobante;
  lineas: LineaDeParte[];
  porItem: ItemDeParte[];
  totales: TotalesCuenta;
  cierraLaCuenta: boolean;
}

export type ResultadoParte =
  | ({ valida: true } & ParteCalculada)
  | { valida: false; codigo: 'PARTE_INVALIDA' | 'NADA_QUE_COBRAR' };

export type ResultadoCambioDeCuenta =
  { permitido: true } | { permitido: false; codigo: 'CUENTA_COBRADA_EN_PARTE' };

// ---------------------------------------------------------------------------------------------
// Lectura de la entrada

const NO_COBRABLE = { valida: false, codigo: 'NADA_QUE_COBRAR' } as const;
const PARTE_NO_VALIDA = { valida: false, codigo: 'PARTE_INVALIDA' } as const;

type Seleccion =
  | { tipo: 'TOTAL' }
  | { tipo: 'ITEMS'; items: { itemId: string; cantidad: number }[] }
  | { tipo: 'IGUALES'; partesRestantes: number };

function leerParte(parte: ParteEntrada): Seleccion {
  if (typeof parte !== 'object' || parte === null) throw new RangeError('La parte no es válida');
  const tipo = delCatalogo(parte.tipo, TIPOS_PARTE, 'El tipo de la parte');
  if (tipo === 'TOTAL') return { tipo };
  if (tipo === 'IGUALES') {
    const { partesRestantes } = parte as { partesRestantes: unknown };
    return { tipo, partesRestantes: entero(partesRestantes, 'Las partes restantes', 1, 50) };
  }
  const { items } = parte as { items: unknown };
  if (!Array.isArray(items) || items.length > 200) {
    throw new RangeError('Los ítems de la parte deben ser una lista de 0 a 200');
  }
  return {
    tipo,
    items: items.map((it: { itemId?: unknown; cantidad?: unknown }, i) => {
      if (typeof it !== 'object' || it === null || typeof it.itemId !== 'string') {
        throw new RangeError(`El ítem ${i + 1} de la parte no es válido`);
      }
      return {
        itemId: it.itemId,
        cantidad: entero(it.cantidad, `La cantidad del ítem ${i + 1}`, 1, 999),
      };
    }),
  };
}

/** Una parte ya cobrada, leída (y validada) tal como la guardó facturación. */
interface ParteLeida {
  tipo: TipoParte;
  total: Dec;
  porItem: { itemId: string; cantidad: number; neto: Dec; bolsas: number }[];
  /** Los "Por consumo" de una parte igual: lo que tomó de cada afectación. */
  consumo: { afectacion: AfectacionIgv; neto: Dec }[];
}

function leerPartesAnteriores(partes: readonly ParteCalculada[]): ParteLeida[] {
  if (!Array.isArray(partes)) throw new RangeError('Las partes anteriores deben ser una lista');
  return partes.map((p, i) => {
    const nombre = `La parte anterior ${i + 1}`;
    if (
      typeof p !== 'object' ||
      p === null ||
      !Array.isArray(p.porItem) ||
      !Array.isArray(p.lineas)
    ) {
      throw new RangeError(`${nombre} no es válida`);
    }
    return {
      tipo: delCatalogo(p.tipo, TIPOS_PARTE, `El tipo de ${nombre}`),
      total: monto(p.totales?.total, `El total de ${nombre}`, ENTEROS_TOTAL),
      porItem: (p.porItem as readonly ItemDeParte[]).map((x) => ({
        itemId: String(x?.itemId),
        cantidad: entero(x?.cantidad, `Una cantidad de ${nombre}`, 0, 999),
        neto: monto(x?.neto, `Un neto de ${nombre}`, ENTEROS_TOTAL),
        bolsas: entero(x?.bolsas, `Unas bolsas de ${nombre}`, 0, 999),
      })),
      consumo:
        p.tipo === 'IGUALES'
          ? (p.lineas as readonly LineaDeParte[])
              .filter((l) => l?.itemId === null)
              .map((l) => ({
                afectacion: delCatalogo(
                  l.afectacion,
                  AFECTACIONES_IGV,
                  `Una afectación de ${nombre}`,
                ),
                neto: monto(l.neto, `Un neto de ${nombre}`, ENTEROS_TOTAL),
              }))
          : [],
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Lo que falta cobrar de la cuenta

interface LineaPendiente {
  itemId: string;
  precio: Dec;
  afectacion: AfectacionIgv;
  aplicaIcbper: boolean;
  /** Unidades cobrables y neto de la cuenta. */
  cantidad: number;
  neto: Dec;
  /** Lo que falta (negativo si las partes anteriores tomaron de más). */
  faltaCantidad: number;
  faltaNeto: Dec;
}

interface Pendiente {
  lineas: LineaPendiente[];
  /** Una parte anterior tomó unidades o dinero de un ítem que ya no está en la cuenta. */
  conItemPerdido: boolean;
  hayIguales: boolean;
  saldo: Dec;
  /** Lo que falta de cada afectación (sin las líneas de ICBPER), en el orden de `AFECTACIONES_IGV`. */
  faltaAfectacion: Dec[];
  bolsasFaltan: number;
  cortesiasPendientes: boolean;
}

function pendiente(
  cuenta: CuentaEntrada,
  calculada: CuentaCalculada,
  partes: readonly ParteLeida[],
): Pendiente {
  const tomado = new Map<string, { cantidad: number; neto: Dec }>();
  for (const p of partes) {
    for (const x of p.porItem) {
      const antes = tomado.get(x.itemId) ?? { cantidad: 0, neto: new D(0) };
      tomado.set(x.itemId, {
        cantidad: antes.cantidad + x.cantidad,
        neto: antes.neto.plus(x.neto),
      });
    }
  }
  const lineas = cuenta.lineas.map((l, i): LineaPendiente => {
    const c = calculada.lineas[i]!;
    const t = tomado.get(l.itemId) ?? { cantidad: 0, neto: new D(0) };
    return {
      itemId: l.itemId,
      precio: new D(l.precioUnitario),
      afectacion: l.afectacion,
      aplicaIcbper: l.aplicaIcbper,
      cantidad: c.cantidadCobrable,
      neto: new D(c.neto),
      faltaCantidad: c.cantidadCobrable - t.cantidad,
      faltaNeto: new D(c.neto).minus(t.neto),
    };
  });
  const conocidos = new Set(cuenta.lineas.map((l) => l.itemId));
  const conItemPerdido = [...tomado].some(
    ([itemId, t]) => !conocidos.has(itemId) && (t.cantidad > 0 || t.neto.gt(0)),
  );
  const hayIguales = partes.some((p) => p.tipo === 'IGUALES');
  const faltaAfectacion = AFECTACIONES_IGV.map((a) =>
    suma(lineas.filter((l) => l.afectacion === a && !l.aplicaIcbper).map((l) => l.faltaNeto)).minus(
      suma(partes.flatMap((p) => p.consumo.filter((c) => c.afectacion === a).map((c) => c.neto))),
    ),
  );
  return {
    lineas,
    conItemPerdido,
    hayIguales,
    saldo: new D(calculada.totales.total).minus(suma(partes.map((p) => p.total))),
    faltaAfectacion,
    bolsasFaltan: lineas.filter((l) => l.aplicaIcbper).reduce((acc, l) => acc + l.faltaCantidad, 0),
    cortesiasPendientes: partes.length === 0 && calculada.lineas.some((l) => l.gratuita !== null),
  };
}

/** Lo que las partes anteriores tomaron de más (la cuenta cambió sin permiso): no hay cómo seguir cobrando. */
function conExceso(p: Pendiente): boolean {
  return (
    p.conItemPerdido ||
    p.saldo.lt(0) ||
    p.faltaAfectacion.some((f) => f.lt(0)) ||
    p.lineas.some((l) => l.faltaCantidad < 0 || l.faltaNeto.lt(0))
  );
}

/** "No falta nada" (criterio 19): ni dinero, ni bolsas, ni cortesías, ni (sin partes iguales) unidades. */
function nadaFalta(p: Pendiente): boolean {
  return (
    p.saldo.isZero() &&
    p.bolsasFaltan === 0 &&
    !p.cortesiasPendientes &&
    (p.hayIguales
      ? p.faltaAfectacion.every((f) => f.isZero())
      : p.lineas.every((l) => l.faltaCantidad === 0))
  );
}

// ---------------------------------------------------------------------------------------------
// Armado de la parte

/** Lo que una parte toma de una línea de la cuenta. */
interface Toma {
  linea: LineaPendiente;
  cantidad: number;
  neto: Dec;
}

/** El neto de `q` de las `n` unidades que faltan: el que falta si se toman todas, o la proporción redondeada. */
function netoDeLaToma(linea: LineaPendiente, q: number): Dec {
  return q === linea.faltaCantidad
    ? linea.faltaNeto
    : redondear(linea.faltaNeto.times(q).div(linea.faltaCantidad));
}

function lineaCobrada(t: Toma, tasaIgv: Dec | null, montoIcbper: Dec): LineaDeParte {
  const bruto = t.linea.precio.times(t.cantidad);
  const { base, igv } = desglosarDec(t.neto, t.linea.afectacion, tasaIgv);
  const bolsas = t.linea.aplicaIcbper ? t.cantidad : 0;
  return {
    itemId: t.linea.itemId,
    cantidad: t.cantidad,
    afectacion: t.linea.afectacion,
    bruto: dos(bruto),
    descuento: dos(bruto.minus(t.neto)),
    neto: dos(t.neto),
    base: dos(base),
    igv: dos(igv),
    bolsas,
    icbper: dos(montoIcbper.times(bolsas)),
    gratuita: null,
  };
}

/** Una línea "Por consumo" de una afectación (de las líneas agrupadas, o de una parte igual). */
function lineaPorConsumo(
  afectacion: AfectacionIgv,
  bruto: Dec,
  neto: Dec,
  tasaIgv: Dec | null,
): LineaDeParte {
  const { base, igv } = desglosarDec(neto, afectacion, tasaIgv);
  return {
    itemId: null,
    cantidad: 1,
    afectacion,
    bruto: dos(bruto),
    descuento: dos(bruto.minus(neto)),
    neto: dos(neto),
    base: dos(base),
    igv: dos(igv),
    bolsas: 0,
    icbper: '0.00',
    gratuita: null,
  };
}

/** Las líneas gratuitas de la cuenta (cortesías), una por ítem y en el orden de la cuenta. */
function lineasGratuitas(cuenta: CuentaEntrada, calculada: CuentaCalculada): LineaDeParte[] {
  return cuenta.lineas.flatMap((l, i) => {
    const gratuita = calculada.lineas[i]!.gratuita;
    if (gratuita === null) return [];
    return [
      {
        itemId: l.itemId,
        cantidad: gratuita.cantidad,
        afectacion: l.afectacion,
        bruto: '0.00',
        descuento: '0.00',
        neto: '0.00',
        base: '0.00',
        igv: '0.00',
        bolsas: 0,
        icbper: '0.00',
        gratuita,
      },
    ];
  });
}

function totalesDeLineas(lineas: readonly LineaDeParte[], conIgv: boolean): TotalesCuenta {
  const de = (campo: (l: LineaDeParte) => string): Dec => suma(lineas.map((l) => new D(campo(l))));
  const porAfectacion = (a: AfectacionIgv): string =>
    dos(suma(lineas.filter((l) => l.afectacion === a).map((l) => new D(l.base))));
  return {
    subtotal: dos(de((l) => l.bruto)),
    descuentos: dos(de((l) => l.descuento)),
    operaciones: conIgv
      ? {
          gravadas: porAfectacion('GRAVADO'),
          exoneradas: porAfectacion('EXONERADO'),
          inafectas: porAfectacion('INAFECTO'),
          gratuitas: dos(suma(lineas.map((l) => new D(l.gratuita?.base ?? 0)))),
        }
      : null,
    igv: dos(de((l) => l.igv)),
    igvGratuitas: dos(suma(lineas.map((l) => new D(l.gratuita?.igv ?? 0)))),
    icbper: dos(de((l) => l.icbper)),
    total: dos(de((l) => l.neto).plus(de((l) => l.icbper))),
  };
}

function itemsDeLaParte(tomas: readonly Toma[]): ItemDeParte[] {
  return tomas.map((t) => ({
    itemId: t.linea.itemId,
    cantidad: t.cantidad,
    neto: dos(t.neto),
    bolsas: t.linea.aplicaIcbper ? t.cantidad : 0,
  }));
}

/** Completa una parte con sus totales y si cierra la cuenta (nada falta después de ella). */
function armarParte(
  cuenta: CuentaEntrada,
  calculada: CuentaCalculada,
  anteriores: readonly ParteLeida[],
  base: Omit<ParteCalculada, 'totales' | 'cierraLaCuenta'>,
): ParteCalculada {
  const parte: ParteCalculada = {
    ...base,
    totales: totalesDeLineas(base.lineas, cuenta.tasaIgv !== null),
    cierraLaCuenta: false,
  };
  const despues = pendiente(cuenta, calculada, [...anteriores, ...leerPartesAnteriores([parte])]);
  parte.cierraLaCuenta = nadaFalta(despues);
  return parte;
}

/** Calcula lo que se cobra ahora de la cuenta, descontando lo que ya tomaron las partes anteriores. */
export function calcularParte(
  cuenta: CuentaEntrada,
  partesAnteriores: readonly ParteCalculada[],
  parte: ParteEntrada,
  formato: FormatoComprobante,
): ResultadoParte {
  // (1) RangeError de la entrada
  const calculada = calcularCuenta(cuenta);
  const seleccion = leerParte(parte);
  const fmt = delCatalogo(formato, FORMATOS_COMPROBANTE, 'El formato');
  const anteriores = leerPartesAnteriores(partesAnteriores);
  const falta = pendiente(cuenta, calculada, anteriores);
  if (conExceso(falta)) {
    throw new RangeError('Las partes anteriores no cuadran con la cuenta');
  }
  const tasaIgv = cuenta.tasaIgv === null ? null : new D(cuenta.tasaIgv);
  const montoIcbper = new D(cuenta.montoIcbper);

  // (2) nada que cobrar; (3) el modo; (4) DETALLADO en partes iguales
  if (nadaFalta(falta)) return NO_COBRABLE;
  if (falta.hayIguales && seleccion.tipo !== 'IGUALES') return PARTE_NO_VALIDA;
  if (seleccion.tipo === 'IGUALES' && fmt === 'DETALLADO') return PARTE_NO_VALIDA;

  const gratuitas = falta.cortesiasPendientes ? lineasGratuitas(cuenta, calculada) : [];

  if (seleccion.tipo === 'IGUALES') {
    return partesIguales(
      cuenta,
      calculada,
      anteriores,
      falta,
      seleccion.partesRestantes,
      tasaIgv,
      montoIcbper,
      gratuitas,
    );
  }

  // (5) los ítems de la selección y (6) selección vacía sin cortesías pendientes
  const tomas: Toma[] = [];
  if (seleccion.tipo === 'TOTAL') {
    for (const linea of falta.lineas) {
      if (linea.faltaCantidad > 0) {
        tomas.push({ linea, cantidad: linea.faltaCantidad, neto: linea.faltaNeto });
      }
    }
  } else {
    const pedidos = new Map<string, number>();
    for (const it of seleccion.items) {
      const linea = falta.lineas.find((l) => l.itemId === it.itemId);
      if (!linea || pedidos.has(it.itemId) || it.cantidad > linea.faltaCantidad) {
        return PARTE_NO_VALIDA;
      }
      pedidos.set(it.itemId, it.cantidad);
    }
    if (seleccion.items.length === 0 && !falta.cortesiasPendientes) return PARTE_NO_VALIDA;
    for (const linea of falta.lineas) {
      const q = pedidos.get(linea.itemId);
      if (q !== undefined) tomas.push({ linea, cantidad: q, neto: netoDeLaToma(linea, q) });
    }
  }

  const cobradas = tomas.map((t) => lineaCobrada(t, tasaIgv, montoIcbper));
  let lineas: LineaDeParte[];
  if (fmt === 'DETALLADO') {
    lineas = cobradas;
  } else {
    // CONSUMO: las líneas sin ICBPER se agrupan por afectación; las de ICBPER siguen detalladas
    const agrupadas = AFECTACIONES_IGV.flatMap((a) => {
      const delGrupo = tomas
        .map((t, i) => ({ t, linea: cobradas[i]! }))
        .filter(({ t }) => !t.linea.aplicaIcbper && t.linea.afectacion === a);
      const neto = suma(delGrupo.map(({ t }) => t.neto));
      if (!neto.gt(0)) return [];
      const bruto = suma(delGrupo.map(({ linea }) => new D(linea.bruto)));
      return [lineaPorConsumo(a, bruto, neto, tasaIgv)];
    });
    lineas = [...agrupadas, ...cobradas.filter((_, i) => tomas[i]!.linea.aplicaIcbper)];
  }
  lineas = [...lineas, ...gratuitas];

  return {
    valida: true,
    ...armarParte(cuenta, calculada, anteriores, {
      tipo: seleccion.tipo,
      formato: fmt,
      lineas,
      porItem: itemsDeLaParte(tomas),
    }),
  };
}

/** Una parte en partes iguales (criterio 18). */
function partesIguales(
  cuenta: CuentaEntrada,
  calculada: CuentaCalculada,
  anteriores: readonly ParteLeida[],
  falta: Pendiente,
  r: number,
  tasaIgv: Dec | null,
  montoIcbper: Dec,
  gratuitas: LineaDeParte[],
): ResultadoParte {
  const montoParte = r === 1 ? falta.saldo : falta.saldo.div(r).toDecimalPlaces(2, D.ROUND_UP);

  // Las bolsas se reparten enteras: ⌈b / r⌉ en esta parte, agotando una línea antes de pasar a la siguiente
  let porTomar = Math.ceil(falta.bolsasFaltan / r);
  const tomas: Toma[] = [];
  for (const linea of falta.lineas) {
    if (!linea.aplicaIcbper || linea.faltaCantidad <= 0 || porTomar === 0) continue;
    const q = Math.min(porTomar, linea.faltaCantidad);
    tomas.push({ linea, cantidad: q, neto: netoDeLaToma(linea, q) });
    porTomar -= q;
  }
  const bolsas = tomas.map((t) => lineaCobrada(t, tasaIgv, montoIcbper));
  const costoBolsas = suma(bolsas.map((l) => new D(l.neto).plus(l.icbper)));

  // (7) el consumo de la parte no puede salir negativo
  const consumo = montoParte.minus(costoBolsas);
  if (consumo.lt(0)) return PARTE_NO_VALIDA;

  // El consumo se reparte entre las afectaciones en proporción a lo que falta de cada una; la última parte toma
  // exactamente lo que falta. Nunca se toma más de lo que falta (los céntimos de redondeo hacia arriba).
  const faltaTotal = suma(falta.faltaAfectacion);
  const porAfectacion =
    r === 1
      ? falta.faltaAfectacion
      : repartirDec(consumo.gt(faltaTotal) ? faltaTotal : consumo, falta.faltaAfectacion);
  const porConsumo = AFECTACIONES_IGV.flatMap((a, i) =>
    porAfectacion[i]!.gt(0)
      ? [lineaPorConsumo(a, porAfectacion[i]!, porAfectacion[i]!, tasaIgv)]
      : [],
  );

  return {
    valida: true,
    ...armarParte(cuenta, calculada, anteriores, {
      tipo: 'IGUALES',
      formato: 'CONSUMO',
      lineas: [...porConsumo, ...bolsas, ...gratuitas],
      porItem: itemsDeLaParte(tomas),
    }),
  };
}

/** Si la cuenta nueva (después de enviar, anular o unir) sigue cuadrando con lo ya cobrado (criterio 20). */
export function cambioDeCuentaPermitido(
  cuentaNueva: CuentaEntrada,
  partesAnteriores: readonly ParteCalculada[],
): ResultadoCambioDeCuenta {
  const calculada = calcularCuenta(cuentaNueva);
  const anteriores = leerPartesAnteriores(partesAnteriores);
  const permitido = { permitido: true } as const;
  const noPermitido = { permitido: false, codigo: 'CUENTA_COBRADA_EN_PARTE' } as const;
  // (a) sin partes anteriores, todo cambio es permitido
  if (anteriores.length === 0) return permitido;
  // (b) con un descuento por cuenta, el prorrateo de lo ya cobrado cambiaría
  if (cuentaNueva.descuentoCuenta !== null) return noPermitido;

  // (c) lo que falta, en unidades y en dinero, no puede quedar negativo ni a medias
  const falta = pendiente(cuentaNueva, calculada, anteriores);
  if (conExceso(falta)) return noPermitido;
  const aMedias = falta.lineas.some((l) => {
    // Con partes iguales las unidades de las líneas sin ICBPER no se cobran por ítem: no hay nada que comparar
    if (falta.hayIguales && !l.aplicaIcbper) return false;
    if (l.faltaCantidad === 0) return !l.faltaNeto.isZero();
    return l.faltaNeto.isZero() && !l.neto.isZero();
  });
  return aMedias ? noPermitido : permitido;
}

/**
 * Si, con la cuenta nueva y lo ya cobrado, no falta nada (criterio 52, la misma definición que `cierraLaCuenta` de una
 * parte): una cuenta con cobros cuyo saldo es 0.00, sin bolsas ni cortesías pendientes ni unidades por cobrar. Una
 * anulación (o cualquier cambio permitido) que la deja así cierra la orden. `false` si no hay partes anteriores o la
 * cuenta no cuadra con ellas (`cambioDeCuentaPermitido` la rechaza).
 */
export function cuentaSinNadaQueFaltar(
  cuentaNueva: CuentaEntrada,
  partesAnteriores: readonly ParteCalculada[],
): boolean {
  const anteriores = leerPartesAnteriores(partesAnteriores);
  if (anteriores.length === 0 || cuentaNueva.descuentoCuenta !== null) return false;
  const falta = pendiente(cuentaNueva, calcularCuenta(cuentaNueva), anteriores);
  return !conExceso(falta) && nadaFalta(falta);
}
