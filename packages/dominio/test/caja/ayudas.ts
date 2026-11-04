// spec: 006-caja-cobro (pruebas protegidas)
//
// Ayudas compartidas de las pruebas de P1 (montos): la cuenta C del enunciado, comprobaciones de los invariantes
// de la cuenta y de las partes, y un generador de cuentas al azar con semilla fija. No contienen reglas de
// negocio: los valores esperados de cada prueba salen de los ejemplos de la especificación.
import Decimal from 'decimal.js';
import { expect } from 'vitest';
import type {
  CuentaCalculada,
  CuentaEntrada,
  DescuentoEntrada,
  LineaDeCuentaEntrada,
  ParteCalculada,
  ResultadoParte,
} from '../../src';

export const D = Decimal.clone({ precision: 40 });

/** Ids de los ítems de la cuenta C (UUID en minúsculas). */
export const ID = {
  lomo: '11111111-1111-4111-8111-111111111111',
  gaseosa: '22222222-2222-4222-8222-222222222222',
  bolsa: '33333333-3333-4333-8333-333333333333',
  mandarina: '44444444-4444-4444-8444-444444444444',
} as const;

/** Lomo saltado × 2 a S/ 28.00 (bruto 56.00). */
export function lineaLomo(cambios: Partial<LineaDeCuentaEntrada> = {}): LineaDeCuentaEntrada {
  return {
    itemId: ID.lomo,
    precioUnitario: '28.00',
    cantidad: 2,
    cantidadCortesia: 0,
    afectacion: 'GRAVADO',
    aplicaIcbper: false,
    descuento: null,
    ...cambios,
  };
}

/** Gaseosa 1 L × 1 a S/ 9.00. */
export function lineaGaseosa(cambios: Partial<LineaDeCuentaEntrada> = {}): LineaDeCuentaEntrada {
  return {
    itemId: ID.gaseosa,
    precioUnitario: '9.00',
    cantidad: 1,
    cantidadCortesia: 0,
    afectacion: 'GRAVADO',
    aplicaIcbper: false,
    descuento: null,
    ...cambios,
  };
}

/** Bolsa plástica × 2 a S/ 0.10, gravada y con ICBPER. */
export function lineaBolsa(cambios: Partial<LineaDeCuentaEntrada> = {}): LineaDeCuentaEntrada {
  return {
    itemId: ID.bolsa,
    precioUnitario: '0.10',
    cantidad: 2,
    cantidadCortesia: 0,
    afectacion: 'GRAVADO',
    aplicaIcbper: true,
    descuento: null,
    ...cambios,
  };
}

/** Mandarina × 1 a S/ 3.00, exonerada. */
export function lineaMandarina(cambios: Partial<LineaDeCuentaEntrada> = {}): LineaDeCuentaEntrada {
  return {
    itemId: ID.mandarina,
    precioUnitario: '3.00',
    cantidad: 1,
    cantidadCortesia: 0,
    afectacion: 'EXONERADO',
    aplicaIcbper: false,
    descuento: null,
    ...cambios,
  };
}

/** La cuenta C de la especificación, con IGV de 18 % e ICBPER de S/ 0.50; `cambios` reemplaza campos. */
export function cuentaC(cambios: Partial<CuentaEntrada> = {}): CuentaEntrada {
  return {
    lineas: [lineaLomo(), lineaGaseosa(), lineaBolsa(), lineaMandarina()],
    descuentoCuenta: null,
    tasaIgv: '18.00',
    montoIcbper: '0.50',
    ...cambios,
  };
}

/** Una cuenta de una sola línea gravada, sin descuentos ni ICBPER. */
export function cuentaUnaLinea(
  precioUnitario: string,
  cambios: Partial<LineaDeCuentaEntrada> = {},
): CuentaEntrada {
  return {
    lineas: [
      {
        itemId: ID.lomo,
        precioUnitario,
        cantidad: 1,
        cantidadCortesia: 0,
        afectacion: 'GRAVADO',
        aplicaIcbper: false,
        descuento: null,
        ...cambios,
      },
    ],
    descuentoCuenta: null,
    tasaIgv: '18.00',
    montoIcbper: '0.50',
  };
}

export const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const dosDec = (x: Decimal.Value): string => new D(x).toFixed(2);

/** Suma de textos decimales, con 2 decimales. */
export function sumar(valores: readonly string[]): string {
  return valores.reduce((acc, v) => acc.plus(v), new D(0)).toFixed(2);
}

/** Devuelve la parte calculada de un resultado que debe ser válido. */
export function tomar(resultado: ResultadoParte): ParteCalculada {
  if (!resultado.valida) {
    throw new Error(`Se esperaba una parte válida y se obtuvo ${resultado.codigo}`);
  }
  return resultado;
}

/**
 * Invariantes de una cuenta calculada (criterios 11 a 16): base + IGV = neto por línea, Σ netos + ICBPER = total,
 * subtotal = Σ bruto, descuentos = Σ de los dos descuentos, IGV = Σ IGV de las líneas y, con operaciones,
 * Σ bases + IGV + ICBPER = total. Si se pasa `montoDescuentoCuenta`, Σ descuento prorrateado = ese monto.
 */
export function verificarInvariantes(
  entrada: CuentaEntrada,
  calculada: CuentaCalculada,
  montoDescuentoCuenta?: string,
): void {
  const { lineas, totales } = calculada;
  expect(lineas).toHaveLength(entrada.lineas.length);
  for (const l of lineas) {
    expect(dosDec(new D(l.base).plus(l.igv))).toBe(l.neto);
    expect(dosDec(new D(l.bruto).minus(l.descuentoItem).minus(l.descuentoCuenta))).toBe(l.neto);
    expect(new D(l.neto).gte(0)).toBe(true);
  }
  const sumaNetos = sumar(lineas.map((l) => l.neto));
  const sumaIcbper = sumar(lineas.map((l) => l.icbper));
  expect(dosDec(new D(sumaNetos).plus(sumaIcbper))).toBe(totales.total);
  expect(totales.subtotal).toBe(sumar(lineas.map((l) => l.bruto)));
  expect(totales.descuentos).toBe(sumar(lineas.flatMap((l) => [l.descuentoItem, l.descuentoCuenta])));
  expect(totales.igv).toBe(sumar(lineas.map((l) => l.igv)));
  expect(totales.icbper).toBe(sumaIcbper);
  if (montoDescuentoCuenta !== undefined) {
    expect(sumar(lineas.map((l) => l.descuentoCuenta))).toBe(montoDescuentoCuenta);
  }
  if (totales.operaciones) {
    const porAfectacion = (a: string): string =>
      sumar(lineas.filter((_, i) => entrada.lineas[i]!.afectacion === a).map((l) => l.base));
    expect(totales.operaciones.gravadas).toBe(porAfectacion('GRAVADO'));
    expect(totales.operaciones.exoneradas).toBe(porAfectacion('EXONERADO'));
    expect(totales.operaciones.inafectas).toBe(porAfectacion('INAFECTO'));
    expect(
      dosDec(
        new D(totales.operaciones.gravadas)
          .plus(totales.operaciones.exoneradas)
          .plus(totales.operaciones.inafectas)
          .plus(totales.igv)
          .plus(totales.icbper),
      ),
    ).toBe(totales.total);
  }
}

/** Invariantes de una parte: nada negativo, base + IGV = neto por línea y totales coherentes. */
export function verificarParte(parte: ParteCalculada): void {
  for (const l of parte.lineas) {
    expect(dosDec(new D(l.base).plus(l.igv))).toBe(l.neto);
    for (const campo of [l.bruto, l.descuento, l.neto, l.base, l.igv, l.icbper]) {
      expect(new D(campo).gte(0)).toBe(true);
    }
  }
  for (const campo of [parte.totales.total, parte.totales.igv, parte.totales.icbper, parte.totales.subtotal]) {
    expect(new D(campo).gte(0)).toBe(true);
  }
  for (const p of parte.porItem) {
    expect(new D(p.neto).gte(0)).toBe(true);
    expect(p.cantidad).toBeGreaterThanOrEqual(0);
    expect(p.bolsas).toBeGreaterThanOrEqual(0);
  }
  if (parte.lineas.every((l) => l.gratuita === null)) {
    expect(
      dosDec(new D(sumar(parte.lineas.map((l) => l.neto))).plus(sumar(parte.lineas.map((l) => l.icbper)))),
    ).toBe(parte.totales.total);
  }
}

// ---------------------------------------------------------------------------------------------
// Generador al azar con semilla fija

/** Generador pseudoaleatorio determinista (mulberry32). */
export function semilla(valor: number): () => number {
  let a = valor >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const entero = (rnd: () => number, min: number, max: number): number =>
  min + Math.floor(rnd() * (max - min + 1));

export const desdeCentimos = (centimos: number): string =>
  `${Math.floor(centimos / 100)}.${String(centimos % 100).padStart(2, '0')}`;

function descuentoAleatorio(rnd: () => number, brutoCentimos: number): DescuentoEntrada | null {
  const x = rnd();
  if (x < 0.4) return null;
  if (x < 0.7) return { tipo: 'PORCENTAJE', valor: String(entero(rnd, 5, 30)) };
  return { tipo: 'MONTO', valor: desdeCentimos(Math.floor((brutoCentimos * entero(rnd, 1, 20)) / 100)) };
}

/**
 * Una cuenta al azar, siempre cobrable en partes iguales: una línea grande (de al menos 2 unidades y sin cortesía),
 * hasta 3 líneas chicas (con cortesías) y, a veces, bolsas con ICBPER. Los descuentos son moderados para que
 * ninguna línea quede en cero.
 */
export function generarCuenta(rnd: () => number): CuentaEntrada {
  const afectaciones = ['GRAVADO', 'GRAVADO', 'EXONERADO', 'INAFECTO'] as const;
  const lineas: LineaDeCuentaEntrada[] = [];
  const precioGrande = entero(rnd, 2000, 6000);
  const cantidadGrande = entero(rnd, 2, 4);
  lineas.push({
    itemId: uuid(1),
    precioUnitario: desdeCentimos(precioGrande),
    cantidad: cantidadGrande,
    cantidadCortesia: 0,
    afectacion: afectaciones[entero(rnd, 0, 3)]!,
    aplicaIcbper: false,
    descuento: descuentoAleatorio(rnd, precioGrande * cantidadGrande),
  });
  const chicas = entero(rnd, 0, 3);
  for (let i = 0; i < chicas; i++) {
    const precio = entero(rnd, 100, 3000);
    const cantidad = entero(rnd, 1, 3);
    const conCortesia = rnd() < 0.3;
    const cantidadCortesia = conCortesia ? entero(rnd, 1, cantidad) : 0;
    lineas.push({
      itemId: uuid(2 + i),
      precioUnitario: desdeCentimos(precio),
      cantidad,
      cantidadCortesia,
      afectacion: afectaciones[entero(rnd, 0, 3)]!,
      aplicaIcbper: false,
      descuento: conCortesia ? null : descuentoAleatorio(rnd, precio * cantidad),
    });
  }
  if (rnd() < 0.4) {
    lineas.push({
      itemId: uuid(10),
      precioUnitario: '0.10',
      cantidad: entero(rnd, 1, 3),
      cantidadCortesia: 0,
      afectacion: 'GRAVADO',
      aplicaIcbper: true,
      descuento: null,
    });
  }
  const y = rnd();
  const descuentoCuenta: DescuentoEntrada | null =
    y < 0.5
      ? null
      : y < 0.75
        ? { tipo: 'PORCENTAJE', valor: String(entero(rnd, 5, 25)) }
        : { tipo: 'MONTO', valor: desdeCentimos(entero(rnd, 50, 300)) };
  const tasas = ['18.00', '10.00', null] as const;
  return { lineas, descuentoCuenta, tasaIgv: tasas[entero(rnd, 0, 2)]!, montoIcbper: '0.50' };
}
