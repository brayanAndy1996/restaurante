// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P8 · Notas de crédito, reglas puras (ruta crítica), criterios 136 (el esperado con `medio`), 143, 147 y 148:
// - `calcularNotaCredito(original, acreditadas, pedido)`: cada ejemplo del criterio 147 (devolver 1 y luego el otro
//   Lomo sin y con el descuento por cuenta, la Bolsa con su ICBPER, la anulación), "Por consumo" entera, línea gratuita,
//   posición inexistente o repetida, más unidades de las que faltan, `NADA_QUE_ACREDITAR`, anulación con acreditadas,
//   Nuevo RUS, `RangeError` de entradas mal formadas (como el criterio 8) y las propiedades con comprobantes y
//   devoluciones al azar con semilla fija;
// - `esperadoDelTurno` con `medio` en los movimientos (criterio 136) y sin él (los resultados del criterio 22).
// Hoy falla por "No implementado": `calcularNotaCredito` lanza `Error('No implementado')` y `esperadoDelTurno` todavía
// trata todos los egresos como de efectivo.
//
// Dudas anotadas (no se prueban porque la especificación no las fija): (1) el valor de `posicion` de cada línea de la nota
// (solo se exige que sean enteros distintos, ascendentes, desde 1 y en el orden de `posicionOrigen`); (2) si Σ base de
// devoluciones parciales de una misma línea puede pasar de la base del original por el redondeo de cada una (por ejemplo,
// 3 unidades de S/ 1.00: 0.85 × 3 = 2.55 contra 2.54 del original): la regla escrita es `desglosar(neto)` por nota, así que
// las propiedades de base e IGV se prueban para la devolución de la línea entera, no para cualquier partición; (3) el tipo
// de pedido desconocido y la devolución con `lineas` vacías (no se afirma ni `RangeError` ni código).
import type Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  calcularNotaCredito,
  desglosar,
  esperadoDelTurno,
  type LineaAcreditada,
  type LineaOriginalDeNota,
  type MontoPorMedio,
  type OriginalDeNota,
  type PedidoDeNota,
} from '../../src';
import { D, entero, semilla } from './ayudas';

// ------------------------------------------------------------------------------------------------
// Los comprobantes de los ejemplos
// ------------------------------------------------------------------------------------------------

const linea = (
  cambios: Partial<LineaOriginalDeNota> & Pick<LineaOriginalDeNota, 'posicion'>,
): LineaOriginalDeNota => ({
  cantidad: 1,
  precioUnitario: '0.00',
  afectacion: 'GRAVADO',
  bruto: '0.00',
  descuento: '0.00',
  neto: '0.00',
  base: '0.00',
  igv: '0.00',
  bolsas: 0,
  icbper: '0.00',
  gratuita: false,
  ...cambios,
});

/** La boleta de la cuenta C sin descuento (criterio 11): Lomo × 2, Gaseosa, Bolsa × 2 y Mandarina exonerada. */
const BOLETA_C: OriginalDeNota = {
  tasaIgv: '18.00',
  lineas: [
    linea({
      posicion: 1,
      cantidad: 2,
      precioUnitario: '28.00',
      bruto: '56.00',
      neto: '56.00',
      base: '47.46',
      igv: '8.54',
    }),
    linea({
      posicion: 2,
      cantidad: 1,
      precioUnitario: '9.00',
      bruto: '9.00',
      neto: '9.00',
      base: '7.63',
      igv: '1.37',
    }),
    linea({
      posicion: 3,
      cantidad: 2,
      precioUnitario: '0.10',
      bruto: '0.20',
      neto: '0.20',
      base: '0.17',
      igv: '0.03',
      bolsas: 2,
      icbper: '1.00',
    }),
    linea({
      posicion: 4,
      cantidad: 1,
      precioUnitario: '3.00',
      afectacion: 'EXONERADO',
      bruto: '3.00',
      neto: '3.00',
      base: '3.00',
      igv: '0.00',
    }),
  ],
};

/** La misma cuenta con el descuento por cuenta de S/ 5.00 (criterio 13). */
const BOLETA_C_CON_DESCUENTO: OriginalDeNota = {
  tasaIgv: '18.00',
  lineas: [
    linea({
      posicion: 1,
      cantidad: 2,
      precioUnitario: '28.00',
      bruto: '56.00',
      descuento: '4.11',
      neto: '51.89',
      base: '43.97',
      igv: '7.92',
    }),
    linea({
      posicion: 2,
      cantidad: 1,
      precioUnitario: '9.00',
      bruto: '9.00',
      descuento: '0.66',
      neto: '8.34',
      base: '7.07',
      igv: '1.27',
    }),
    linea({
      posicion: 3,
      cantidad: 2,
      precioUnitario: '0.10',
      bruto: '0.20',
      descuento: '0.01',
      neto: '0.19',
      base: '0.16',
      igv: '0.03',
      bolsas: 2,
      icbper: '1.00',
    }),
    linea({
      posicion: 4,
      cantidad: 1,
      precioUnitario: '3.00',
      afectacion: 'EXONERADO',
      bruto: '3.00',
      descuento: '0.22',
      neto: '2.78',
      base: '2.78',
      igv: '0.00',
    }),
  ],
};

const devolucion = (...lineas: Array<[number, number]>): PedidoDeNota => ({
  tipo: 'DEVOLUCION',
  lineas: lineas.map(([posicion, cantidad]) => ({ posicion, cantidad })),
});
const ANULACION: PedidoDeNota = { tipo: 'ANULACION' };

/**
 * Lo acreditado por una nota anterior. Desde la regla de la última devolución (criterio 147, decisión del 2026-11-06) el
 * cálculo necesita también la base y el IGV ya acreditados de cada línea: `LineaAcreditada` los lleva como `base` e `igv`
 * (esta ayuda los agrega; por defecto el desglose del neto al 18 % gravado, que es el de los ejemplos).
 */
type Acreditada = LineaAcreditada & { base: string; igv: string };
const acreditada = (
  posicionOrigen: number,
  cantidad: number,
  neto: string,
  extra: Partial<Acreditada> = {},
): Acreditada => ({
  posicionOrigen,
  cantidad,
  neto,
  bolsas: 0,
  icbper: '0.00',
  ...desglosar(neto, 'GRAVADO', '18.00'),
  ...extra,
});
/** Lo que acredita una línea de nota ya calculada. */
const acreditadaDe = (l: {
  posicionOrigen: number;
  cantidad: number;
  neto: string;
  base: string;
  igv: string;
  bolsas: number;
  icbper: string;
}): Acreditada => ({
  posicionOrigen: l.posicionOrigen,
  cantidad: l.cantidad,
  neto: l.neto,
  base: l.base,
  igv: l.igv,
  bolsas: l.bolsas,
  icbper: l.icbper,
});

/** Exige un resultado válido y lo devuelve. */
function valida(r: ReturnType<typeof calcularNotaCredito>) {
  if (!r.valida) throw new Error(`Se esperaba una nota válida y se obtuvo ${r.codigo}`);
  return r;
}

const dos = (x: Decimal.Value): string => new D(x).toFixed(2);
const sumar = (valores: readonly string[]): string =>
  valores.reduce((acc, v) => acc.plus(v), new D(0)).toFixed(2);

// ------------------------------------------------------------------------------------------------
describe('calcularNotaCredito · criterio 147 · devolución de unidades', () => {
  it('devolver 1 Lomo de la cuenta C: { bruto 28.00, neto 28.00, base 23.73, igv 4.27 } y total 28.00', () => {
    const r = valida(calcularNotaCredito(BOLETA_C, [], devolucion([1, 1])));
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]).toMatchObject({
      posicionOrigen: 1,
      cantidad: 1,
      precioUnitario: '28.00',
      afectacion: 'GRAVADO',
      bruto: '28.00',
      descuento: '0.00',
      neto: '28.00',
      base: '23.73',
      igv: '4.27',
      bolsas: 0,
      icbper: '0.00',
      gratuita: false,
    });
    expect(r.totales).toEqual({
      subtotal: '28.00',
      descuentos: '0.00',
      operaciones: { gravadas: '23.73', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '4.27',
      igvGratuitas: '0.00',
      icbper: '0.00',
      total: '28.00',
    });
  });

  it('después, devolver el otro Lomo da otra vez 28.00 con base 23.73 e igv 4.27: las dos suman el IGV del original (8.54)', () => {
    const primera = valida(calcularNotaCredito(BOLETA_C, [], devolucion([1, 1])));
    const previas = [acreditadaDe(primera.lineas[0]!)];
    const segunda = valida(calcularNotaCredito(BOLETA_C, previas, devolucion([1, 1])));
    expect(segunda.lineas[0]).toMatchObject({
      cantidad: 1,
      bruto: '28.00',
      neto: '28.00',
      base: '23.73',
      igv: '4.27',
    });
    expect(segunda.totales.total).toBe('28.00');
    expect(sumar([primera.lineas[0]!.igv, segunda.lineas[0]!.igv])).toBe('8.54');
    expect(sumar([primera.lineas[0]!.base, segunda.lineas[0]!.base])).toBe('47.46');
  });

  it('devolver 1 Bolsa: { neto 0.10, base 0.08, igv 0.02, bolsas 1, icbper 0.50 } y total 0.60', () => {
    const r = valida(calcularNotaCredito(BOLETA_C, [], devolucion([3, 1])));
    expect(r.lineas[0]).toMatchObject({
      posicionOrigen: 3,
      cantidad: 1,
      bruto: '0.10',
      descuento: '0.00',
      neto: '0.10',
      base: '0.08',
      igv: '0.02',
      bolsas: 1,
      icbper: '0.50',
    });
    expect(r.totales.icbper).toBe('0.50');
    expect(r.totales.total).toBe('0.60');
  });

  it('devolver las 2 Bolsas de una vez: neto 0.20, bolsas 2 e icbper 1.00 (total 1.20)', () => {
    const r = valida(calcularNotaCredito(BOLETA_C, [], devolucion([3, 2])));
    expect(r.lineas[0]).toMatchObject({ neto: '0.20', bolsas: 2, icbper: '1.00' });
    expect(r.totales.total).toBe('1.20');
  });

  it('devolver la Mandarina exonerada: base = neto, igv 0.00 y la operación va en exoneradas', () => {
    const r = valida(calcularNotaCredito(BOLETA_C, [], devolucion([4, 1])));
    expect(r.lineas[0]).toMatchObject({
      neto: '3.00',
      base: '3.00',
      igv: '0.00',
      afectacion: 'EXONERADO',
    });
    expect(r.totales.operaciones).toEqual({
      gravadas: '0.00',
      exoneradas: '3.00',
      inafectas: '0.00',
      gratuitas: '0.00',
    });
    expect(r.totales.total).toBe('3.00');
  });

  it('con el descuento por cuenta de S/ 5.00: 1 Lomo → { bruto 28.00, descuento 2.05, neto 25.95, base 21.99, igv 3.96 }', () => {
    const r = valida(calcularNotaCredito(BOLETA_C_CON_DESCUENTO, [], devolucion([1, 1])));
    expect(r.lineas[0]).toMatchObject({
      cantidad: 1,
      bruto: '28.00',
      descuento: '2.05',
      neto: '25.95',
      base: '21.99',
      igv: '3.96',
    });
    expect(r.totales).toMatchObject({
      subtotal: '28.00',
      descuentos: '2.05',
      igv: '3.96',
      total: '25.95',
    });
  });

  it('con el descuento: el otro Lomo → { 28.00, 2.06, 25.94, 21.98, 3.96 } y Σ base 43.97 e IGV 7.92, los del original', () => {
    const primera = valida(calcularNotaCredito(BOLETA_C_CON_DESCUENTO, [], devolucion([1, 1])));
    const segunda = valida(
      calcularNotaCredito(
        BOLETA_C_CON_DESCUENTO,
        [acreditadaDe(primera.lineas[0]!)],
        devolucion([1, 1]),
      ),
    );
    expect(segunda.lineas[0]).toMatchObject({
      bruto: '28.00',
      descuento: '2.06',
      neto: '25.94',
      base: '21.98',
      igv: '3.96',
    });
    expect(sumar([primera.lineas[0]!.base, segunda.lineas[0]!.base])).toBe('43.97');
    expect(sumar([primera.lineas[0]!.igv, segunda.lineas[0]!.igv])).toBe('7.92');
    expect(sumar([primera.lineas[0]!.neto, segunda.lineas[0]!.neto])).toBe('51.89');
  });

  it('3 unidades de S/ 1.00 (base 2.54, IGV 0.46) devueltas de una en una: 0.85/0.15, 0.85/0.15 y la última 0.84/0.16 (cierra el original)', () => {
    const tres: OriginalDeNota = {
      tasaIgv: '18.00',
      lineas: [
        linea({
          posicion: 1,
          cantidad: 3,
          precioUnitario: '1.00',
          bruto: '3.00',
          neto: '3.00',
          base: '2.54',
          igv: '0.46',
        }),
      ],
    };
    const previas: Acreditada[] = [];
    const devueltas = [];
    for (const [base, igv] of [
      ['0.85', '0.15'],
      ['0.85', '0.15'],
      ['0.84', '0.16'],
    ] as const) {
      const r = valida(calcularNotaCredito(tres, previas, devolucion([1, 1])));
      expect(r.lineas[0], `devolución ${devueltas.length + 1}`).toMatchObject({
        cantidad: 1,
        neto: '1.00',
        base,
        igv,
      });
      expect(r.totales.igv).toBe(igv);
      previas.push(acreditadaDe(r.lineas[0]!));
      devueltas.push(r.lineas[0]!);
    }
    expect(sumar(devueltas.map((l) => l.base))).toBe('2.54');
    expect(sumar(devueltas.map((l) => l.igv))).toBe('0.46');
    expect(calcularNotaCredito(tres, previas, devolucion([1, 1]))).toEqual({
      valida: false,
      codigo: 'NADA_QUE_ACREDITAR',
    });
  });

  it('devolver las 3 unidades de una vez (q = n) da exactamente la base 2.54 y el IGV 0.46 del original', () => {
    const tres: OriginalDeNota = {
      tasaIgv: '18.00',
      lineas: [
        linea({
          posicion: 1,
          cantidad: 3,
          precioUnitario: '1.00',
          bruto: '3.00',
          neto: '3.00',
          base: '2.54',
          igv: '0.46',
        }),
      ],
    };
    const r = valida(calcularNotaCredito(tres, [], devolucion([1, 3])));
    expect(r.lineas[0]).toMatchObject({ neto: '3.00', base: '2.54', igv: '0.46' });
    // Y 2 y luego 1: la primera desglosa su neto (1.69/0.31) y la última toma lo que falta (0.85/0.15).
    const dos2 = valida(calcularNotaCredito(tres, [], devolucion([1, 2])));
    expect(dos2.lineas[0]).toMatchObject({ neto: '2.00', base: '1.69', igv: '0.31' });
    const resto = valida(
      calcularNotaCredito(tres, [acreditadaDe(dos2.lineas[0]!)], devolucion([1, 1])),
    );
    expect(resto.lineas[0]).toMatchObject({ neto: '1.00', base: '0.85', igv: '0.15' });
  });

  it('varias líneas en una devolución salen en el orden de la posición de origen aunque el pedido venga desordenado', () => {
    const r = valida(calcularNotaCredito(BOLETA_C, [], devolucion([4, 1], [1, 1], [3, 1])));
    expect(r.lineas.map((l) => l.posicionOrigen)).toEqual([1, 3, 4]);
    const posiciones = r.lineas.map((l) => l.posicion);
    expect(posiciones.every((p) => Number.isInteger(p) && p >= 1)).toBe(true);
    expect(new Set(posiciones).size).toBe(3);
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    expect(r.totales.total).toBe(dos(new D('28.00').plus('0.10').plus('0.50').plus('3.00')));
    expect(r.totales.subtotal).toBe('31.10');
  });

  it('suma lo ya acreditado por varias notas de la misma línea: dos notas de 1 Bolsa agotan la línea', () => {
    const previas = [
      acreditada(3, 1, '0.10', { bolsas: 1, icbper: '0.50' }),
      acreditada(3, 1, '0.10', { bolsas: 1, icbper: '0.50' }),
    ];
    expect(calcularNotaCredito(BOLETA_C, previas, devolucion([3, 1]))).toEqual({
      valida: false,
      codigo: 'NADA_QUE_ACREDITAR',
    });
    // Las demás líneas siguen disponibles.
    expect(valida(calcularNotaCredito(BOLETA_C, previas, devolucion([1, 2]))).totales.total).toBe(
      '56.00',
    );
  });
});

// ------------------------------------------------------------------------------------------------
describe('calcularNotaCredito · criterio 147 · anulación', () => {
  it('anular la cuenta C: las cuatro líneas, total 69.20, igv 9.94 e icbper 1.00', () => {
    const r = valida(calcularNotaCredito(BOLETA_C, [], ANULACION));
    expect(r.lineas).toHaveLength(4);
    expect(r.lineas.map((l) => l.posicionOrigen)).toEqual([1, 2, 3, 4]);
    expect(r.totales).toEqual({
      subtotal: '68.20',
      descuentos: '0.00',
      operaciones: {
        gravadas: '55.26',
        exoneradas: '3.00',
        inafectas: '0.00',
        gratuitas: '0.00',
      },
      igv: '9.94',
      igvGratuitas: '0.00',
      icbper: '1.00',
      total: '69.20',
    });
  });

  it('cada línea de la anulación es la del original tal cual', () => {
    const r = valida(calcularNotaCredito(BOLETA_C_CON_DESCUENTO, [], ANULACION));
    for (const l of r.lineas) {
      const o = BOLETA_C_CON_DESCUENTO.lineas.find((x) => x.posicion === l.posicionOrigen)!;
      expect(l).toMatchObject({
        cantidad: o.cantidad,
        precioUnitario: o.precioUnitario,
        afectacion: o.afectacion,
        bruto: o.bruto,
        descuento: o.descuento,
        neto: o.neto,
        base: o.base,
        igv: o.igv,
        bolsas: o.bolsas,
        icbper: o.icbper,
        gratuita: false,
      });
    }
    expect(r.totales.total).toBe('64.20');
    expect(r.totales.descuentos).toBe('5.00');
  });

  it('la anulación acredita también las líneas gratuitas, con su valor referencial', () => {
    const conCortesia: OriginalDeNota = {
      tasaIgv: '18.00',
      lineas: [
        linea({
          posicion: 1,
          cantidad: 2,
          precioUnitario: '28.00',
          bruto: '56.00',
          neto: '56.00',
          base: '47.46',
          igv: '8.54',
        }),
        linea({
          posicion: 2,
          cantidad: 1,
          precioUnitario: '9.00',
          gratuita: true,
          valorReferencial: '9.00',
          baseReferencial: '7.63',
          igvReferencial: '1.37',
        }),
      ],
    };
    const r = valida(calcularNotaCredito(conCortesia, [], ANULACION));
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[1]).toMatchObject({
      posicionOrigen: 2,
      gratuita: true,
      neto: '0.00',
      valorReferencial: '9.00',
      baseReferencial: '7.63',
      igvReferencial: '1.37',
    });
    expect(r.totales.operaciones?.gratuitas).toBe('7.63');
    expect(r.totales.igvGratuitas).toBe('1.37');
    // Lo gratuito no entra en el IGV ni en el total.
    expect(r.totales.igv).toBe('8.54');
    expect(r.totales.total).toBe('56.00');
  });

  it('con alguna línea ya acreditada, la anulación es NOTA_CREDITO_INVALIDA', () => {
    expect(calcularNotaCredito(BOLETA_C, [acreditada(2, 1, '9.00')], ANULACION)).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
  });
});

// ------------------------------------------------------------------------------------------------
describe('calcularNotaCredito · criterio 147 · casos especiales', () => {
  const ORIGINAL_POR_CONSUMO: OriginalDeNota = {
    tasaIgv: '18.00',
    lineas: [
      linea({
        posicion: 1,
        cantidad: 1,
        precioUnitario: '65.20',
        bruto: '65.20',
        neto: '65.20',
        base: '55.25',
        igv: '9.95',
      }),
      linea({
        posicion: 2,
        cantidad: 1,
        precioUnitario: '3.00',
        afectacion: 'EXONERADO',
        bruto: '3.00',
        neto: '3.00',
        base: '3.00',
      }),
    ],
  };

  it('una línea "Por consumo" (cantidad 1) se devuelve entera', () => {
    const r = valida(calcularNotaCredito(ORIGINAL_POR_CONSUMO, [], devolucion([1, 1])));
    expect(r.lineas[0]).toMatchObject({
      cantidad: 1,
      bruto: '65.20',
      neto: '65.20',
      base: '55.25',
      igv: '9.95',
    });
    expect(r.totales.total).toBe('65.20');
  });

  it('una línea "Por consumo" no admite más de 1 unidad ni se devuelve dos veces', () => {
    expect(calcularNotaCredito(ORIGINAL_POR_CONSUMO, [], devolucion([1, 2]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
    expect(
      calcularNotaCredito(ORIGINAL_POR_CONSUMO, [acreditada(1, 1, '65.20')], devolucion([1, 1])),
    ).toEqual({ valida: false, codigo: 'NADA_QUE_ACREDITAR' });
  });

  it('una línea gratuita no se devuelve: NOTA_CREDITO_INVALIDA', () => {
    const conCortesia: OriginalDeNota = {
      tasaIgv: '18.00',
      lineas: [
        BOLETA_C.lineas[0]!,
        linea({
          posicion: 2,
          cantidad: 1,
          precioUnitario: '9.00',
          gratuita: true,
          valorReferencial: '9.00',
          baseReferencial: '7.63',
          igvReferencial: '1.37',
        }),
      ],
    };
    expect(calcularNotaCredito(conCortesia, [], devolucion([2, 1]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
    // Junto con una línea válida, la nota entera es inválida.
    expect(calcularNotaCredito(conCortesia, [], devolucion([1, 1], [2, 1]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
  });

  it('una posición que no existe en el original es NOTA_CREDITO_INVALIDA', () => {
    expect(calcularNotaCredito(BOLETA_C, [], devolucion([9, 1]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
    expect(calcularNotaCredito(BOLETA_C, [], devolucion([1, 1], [9, 1]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
  });

  it('una posición repetida en el pedido es NOTA_CREDITO_INVALIDA', () => {
    expect(calcularNotaCredito(BOLETA_C, [], devolucion([1, 1], [1, 1]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
  });

  it('más unidades de las que faltan es NOTA_CREDITO_INVALIDA (3 Lomos de 2; 2 Lomos con 1 ya devuelto)', () => {
    expect(calcularNotaCredito(BOLETA_C, [], devolucion([1, 3]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
    expect(calcularNotaCredito(BOLETA_C, [acreditada(1, 1, '28.00')], devolucion([1, 2]))).toEqual({
      valida: false,
      codigo: 'NOTA_CREDITO_INVALIDA',
    });
  });

  it('una línea a la que no le falta nada es NADA_QUE_ACREDITAR', () => {
    expect(calcularNotaCredito(BOLETA_C, [acreditada(1, 2, '56.00')], devolucion([1, 1]))).toEqual({
      valida: false,
      codigo: 'NADA_QUE_ACREDITAR',
    });
  });

  it('con Nuevo RUS (tasa null) la base es el neto, el IGV 0.00 y no hay operaciones', () => {
    const rus: OriginalDeNota = {
      tasaIgv: null,
      lineas: [
        linea({
          posicion: 1,
          cantidad: 2,
          precioUnitario: '28.00',
          bruto: '56.00',
          neto: '56.00',
          base: '56.00',
          igv: '0.00',
        }),
        linea({
          posicion: 2,
          cantidad: 2,
          precioUnitario: '0.10',
          bruto: '0.20',
          neto: '0.20',
          base: '0.20',
          igv: '0.00',
          bolsas: 2,
          icbper: '1.00',
        }),
      ],
    };
    const r = valida(calcularNotaCredito(rus, [], devolucion([1, 1], [2, 1])));
    expect(r.lineas[0]).toMatchObject({ neto: '28.00', base: '28.00', igv: '0.00' });
    expect(r.lineas[1]).toMatchObject({ neto: '0.10', base: '0.10', igv: '0.00', icbper: '0.50' });
    expect(r.totales.operaciones).toBeNull();
    expect(r.totales.igv).toBe('0.00');
    expect(r.totales.total).toBe('28.60');
    const anulada = valida(calcularNotaCredito(rus, [], ANULACION));
    expect(anulada.totales.operaciones).toBeNull();
    expect(anulada.totales.total).toBe('57.20');
  });

  it('la tasa del original manda: con 10.00 el desglose de 28.00 es base 25.45 e igv 2.55', () => {
    const al10: OriginalDeNota = {
      tasaIgv: '10.00',
      lineas: [
        linea({
          posicion: 1,
          cantidad: 2,
          precioUnitario: '28.00',
          bruto: '56.00',
          neto: '56.00',
          base: '50.91',
          igv: '5.09',
        }),
      ],
    };
    const r = valida(calcularNotaCredito(al10, [], devolucion([1, 1])));
    expect(r.lineas[0]).toMatchObject({ neto: '28.00', base: '25.45', igv: '2.55' });
  });
});

// ------------------------------------------------------------------------------------------------
describe('calcularNotaCredito · RangeError con una entrada mal formada (criterio 8)', () => {
  const llamar = (original: unknown, acreditadas: unknown, pedido: unknown) => () =>
    calcularNotaCredito(original as never, acreditadas as never, pedido as never);

  it('el original no es un objeto o sus líneas no son una lista', () => {
    expect(llamar(null, [], ANULACION)).toThrow(RangeError);
    expect(llamar({ tasaIgv: '18.00', lineas: 'x' }, [], ANULACION)).toThrow(RangeError);
  });

  it('la tasa del original no es texto, no es un número o está fuera de 0.01 a 30.00', () => {
    for (const tasaIgv of [18, 'x', '31.00', '0.00']) {
      expect(llamar({ ...BOLETA_C, tasaIgv }, [], devolucion([1, 1])), String(tasaIgv)).toThrow(
        RangeError,
      );
    }
  });

  it('un monto que no es texto o no tiene el formato de montos', () => {
    const conNeto = (neto: unknown): unknown => ({
      ...BOLETA_C,
      lineas: [{ ...BOLETA_C.lineas[0]!, neto }],
    });
    for (const neto of [56, '56', '56.0', '-1.00', 'abc', null]) {
      expect(llamar(conNeto(neto), [], devolucion([1, 1])), String(neto)).toThrow(RangeError);
    }
  });

  it('una cantidad del original que no es entero positivo, o una afectación fuera del catálogo', () => {
    const conLinea = (cambios: object): unknown => ({
      ...BOLETA_C,
      lineas: [{ ...BOLETA_C.lineas[0]!, ...cambios }],
    });
    expect(llamar(conLinea({ cantidad: 0 }), [], ANULACION)).toThrow(RangeError);
    expect(llamar(conLinea({ cantidad: 1.5 }), [], ANULACION)).toThrow(RangeError);
    expect(llamar(conLinea({ afectacion: 'OTRA' }), [], ANULACION)).toThrow(RangeError);
  });

  it('el pedido: nulo, sin lista de líneas o con cantidades fuera de 1 a 999 o no enteras', () => {
    expect(llamar(BOLETA_C, [], null)).toThrow(RangeError);
    expect(llamar(BOLETA_C, [], { tipo: 'DEVOLUCION', lineas: 'x' })).toThrow(RangeError);
    for (const cantidad of [0, -1, 1.5, 1000, '1']) {
      expect(
        llamar(BOLETA_C, [], { tipo: 'DEVOLUCION', lineas: [{ posicion: 1, cantidad }] }),
        String(cantidad),
      ).toThrow(RangeError);
    }
    expect(
      llamar(BOLETA_C, [], { tipo: 'DEVOLUCION', lineas: [{ posicion: 1.5, cantidad: 1 }] }),
    ).toThrow(RangeError);
  });

  it('lo acreditado: no es una lista o trae cantidades y montos mal formados', () => {
    expect(llamar(BOLETA_C, 'x', devolucion([1, 1]))).toThrow(RangeError);
    expect(
      llamar(
        BOLETA_C,
        [{ posicionOrigen: 1, cantidad: -1, neto: '1.00', bolsas: 0, icbper: '0.00' }],
        devolucion([1, 1]),
      ),
    ).toThrow(RangeError);
    expect(
      llamar(
        BOLETA_C,
        [{ posicionOrigen: 1, cantidad: 1, neto: 28, bolsas: 0, icbper: '0.00' }],
        devolucion([1, 1]),
      ),
    ).toThrow(RangeError);
  });
});

// ------------------------------------------------------------------------------------------------
// Propiedades con comprobantes y devoluciones al azar (semilla fija)
// ------------------------------------------------------------------------------------------------

const centimos = (c: number): string =>
  `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

/** Un comprobante al azar: líneas gravadas, exoneradas o inafectas, con descuento y bolsas; opcionalmente una gratuita. */
function originalAlAzar(rnd: () => number, conGratuita: boolean): OriginalDeNota {
  const tasas = ['18.00', '10.00', null] as const;
  const tasaIgv = tasas[entero(rnd, 0, 2)]!;
  const afectaciones = ['GRAVADO', 'GRAVADO', 'EXONERADO', 'INAFECTO'] as const;
  const lineas: LineaOriginalDeNota[] = [];
  const cuantas = entero(rnd, 1, 5);
  for (let i = 1; i <= cuantas; i++) {
    const cantidad = entero(rnd, 1, 6);
    const precioCentimos = entero(rnd, 50, 9000);
    const afectacion = afectaciones[entero(rnd, 0, 3)]!;
    const brutoCentimos = precioCentimos * cantidad;
    const descuentoCentimos = rnd() < 0.5 ? 0 : entero(rnd, 1, Math.max(1, brutoCentimos - 1));
    const netoCentimos = brutoCentimos - (brutoCentimos > 1 ? descuentoCentimos : 0);
    const { base, igv } = desglosar(centimos(netoCentimos), afectacion, tasaIgv);
    lineas.push({
      posicion: i,
      cantidad,
      precioUnitario: centimos(precioCentimos),
      afectacion,
      bruto: centimos(brutoCentimos),
      descuento: centimos(brutoCentimos - netoCentimos),
      neto: centimos(netoCentimos),
      base,
      igv,
      bolsas: 0,
      icbper: '0.00',
      gratuita: false,
    });
  }
  if (rnd() < 0.5) {
    const cantidad = entero(rnd, 1, 8);
    const brutoCentimos = 10 * cantidad;
    const { base, igv } = desglosar(centimos(brutoCentimos), 'GRAVADO', tasaIgv);
    lineas.push({
      posicion: lineas.length + 1,
      cantidad,
      precioUnitario: '0.10',
      afectacion: 'GRAVADO',
      bruto: centimos(brutoCentimos),
      descuento: '0.00',
      neto: centimos(brutoCentimos),
      base,
      igv,
      bolsas: cantidad,
      icbper: dos(new D('0.50').times(cantidad)),
      gratuita: false,
    });
  }
  if (conGratuita) {
    const valor = centimos(entero(rnd, 100, 3000));
    const { base, igv } = desglosar(valor, 'GRAVADO', tasaIgv);
    lineas.push({
      posicion: lineas.length + 1,
      cantidad: 1,
      precioUnitario: valor,
      afectacion: 'GRAVADO',
      bruto: '0.00',
      descuento: '0.00',
      neto: '0.00',
      base: '0.00',
      igv: '0.00',
      bolsas: 0,
      icbper: '0.00',
      gratuita: true,
      valorReferencial: valor,
      baseReferencial: base,
      igvReferencial: igv,
    });
  }
  return { tasaIgv, lineas };
}

describe('calcularNotaCredito · propiedades con comprobantes al azar (semilla fija)', () => {
  const ITERACIONES = 250;

  it('devoluciones al azar: nunca se acredita más que el original en unidades, neto, base, IGV, bolsas ni ICBPER, y al agotarlas queda exacto', () => {
    const rnd = semilla(20261106);
    for (let n = 0; n < ITERACIONES; n++) {
      const original = originalAlAzar(rnd, false);
      const acreditadas: Acreditada[] = [];
      const total = (
        p: number,
        campo: 'cantidad' | 'neto' | 'bolsas' | 'icbper' | 'base' | 'igv',
      ): Decimal =>
        acreditadas
          .filter((a) => a.posicionOrigen === p)
          .reduce((s, a) => s.plus(a[campo]), new D(0));
      for (let paso = 0; paso < 60; paso++) {
        const pendientes = original.lineas.filter(
          (l) => l.cantidad - Number(total(l.posicion, 'cantidad')) > 0,
        );
        if (pendientes.length === 0) break;
        const elegidas = pendientes.filter((_, i) => i === 0 || rnd() < 0.5);
        const pedido = devolucion(
          ...elegidas.map((l): [number, number] => [
            l.posicion,
            entero(rnd, 1, l.cantidad - Number(total(l.posicion, 'cantidad'))),
          ]),
        );
        const r = valida(calcularNotaCredito(original, acreditadas, pedido));
        let sumaNetos = new D(0);
        let sumaIcbper = new D(0);
        for (const l of r.lineas) {
          expect(dos(new D(l.base).plus(l.igv)), 'base + igv = neto').toBe(l.neto);
          expect(dos(new D(l.bruto).minus(l.descuento)), 'bruto - descuento = neto').toBe(l.neto);
          expect(new D(l.neto).gte(0)).toBe(true);
          sumaNetos = sumaNetos.plus(l.neto);
          sumaIcbper = sumaIcbper.plus(l.icbper);
          acreditadas.push(acreditadaDe(l));
        }
        expect(r.totales.total).toBe(dos(sumaNetos.plus(sumaIcbper)));
        expect(r.totales.icbper).toBe(dos(sumaIcbper));
        for (const o of original.lineas) {
          expect(Number(total(o.posicion, 'cantidad'))).toBeLessThanOrEqual(o.cantidad);
          expect(total(o.posicion, 'neto').lte(o.neto)).toBe(true);
          expect(Number(total(o.posicion, 'bolsas'))).toBeLessThanOrEqual(o.bolsas);
          expect(total(o.posicion, 'icbper').lte(o.icbper)).toBe(true);
          // Regla nueva del criterio 147: tampoco se pasa de la base ni del IGV del original.
          expect(total(o.posicion, 'base').lte(o.base), `base de ${o.posicion}`).toBe(true);
          expect(total(o.posicion, 'igv').lte(o.igv), `igv de ${o.posicion}`).toBe(true);
        }
      }
      for (const o of original.lineas) {
        expect(Number(total(o.posicion, 'cantidad')), `cantidad de ${o.posicion}`).toBe(o.cantidad);
        expect(dos(total(o.posicion, 'neto')), `neto de ${o.posicion}`).toBe(o.neto);
        expect(Number(total(o.posicion, 'bolsas')), `bolsas de ${o.posicion}`).toBe(o.bolsas);
        expect(dos(total(o.posicion, 'icbper')), `icbper de ${o.posicion}`).toBe(o.icbper);
        // Devolver todo, de cualquier forma, da exactamente la base y el IGV del original.
        expect(dos(total(o.posicion, 'base')), `base de ${o.posicion}`).toBe(o.base);
        expect(dos(total(o.posicion, 'igv')), `igv de ${o.posicion}`).toBe(o.igv);
        // Agotada la línea, pedirla otra vez no deja nada que acreditar.
        expect(calcularNotaCredito(original, acreditadas, devolucion([o.posicion, 1]))).toEqual({
          valida: false,
          codigo: 'NADA_QUE_ACREDITAR',
        });
      }
    }
  });

  it('devolver todo línea por línea (una nota por línea, entera) da exactamente el original, también en base e IGV', () => {
    const rnd = semilla(7_654_321);
    for (let n = 0; n < ITERACIONES; n++) {
      const original = originalAlAzar(rnd, false);
      const acreditadas: Acreditada[] = [];
      const notas = original.lineas.map((o) => {
        const r = valida(
          calcularNotaCredito(original, acreditadas, devolucion([o.posicion, o.cantidad])),
        );
        acreditadas.push(acreditadaDe(r.lineas[0]!));
        return r;
      });
      const lineas = notas.flatMap((r) => r.lineas);
      for (const o of original.lineas) {
        const l = lineas.find((x) => x.posicionOrigen === o.posicion)!;
        expect(l).toMatchObject({
          cantidad: o.cantidad,
          bruto: o.bruto,
          descuento: o.descuento,
          neto: o.neto,
          base: o.base,
          igv: o.igv,
          bolsas: o.bolsas,
          icbper: o.icbper,
        });
      }
      expect(sumar(lineas.map((l) => l.base))).toBe(sumar(original.lineas.map((l) => l.base)));
      expect(sumar(lineas.map((l) => l.igv))).toBe(sumar(original.lineas.map((l) => l.igv)));
      expect(sumar(notas.map((r) => r.totales.total))).toBe(
        dos(original.lineas.reduce((s, l) => s.plus(l.neto).plus(l.icbper), new D(0))),
      );
    }
  });

  it('devolver todas las líneas en una sola nota da el mismo resultado que anular (sin líneas gratuitas)', () => {
    const rnd = semilla(424_242);
    for (let n = 0; n < ITERACIONES; n++) {
      const original = originalAlAzar(rnd, false);
      const anulada = valida(calcularNotaCredito(original, [], ANULACION));
      const devuelta = valida(
        calcularNotaCredito(
          original,
          [],
          devolucion(...original.lineas.map((l): [number, number] => [l.posicion, l.cantidad])),
        ),
      );
      expect(devuelta.totales).toEqual(anulada.totales);
      expect(
        devuelta.lineas.map((l) => [l.posicionOrigen, l.cantidad, l.neto, l.base, l.igv]),
      ).toEqual(anulada.lineas.map((l) => [l.posicionOrigen, l.cantidad, l.neto, l.base, l.igv]));
      expect(anulada.totales.total).toBe(
        dos(original.lineas.reduce((s, l) => s.plus(l.neto).plus(l.icbper), new D(0))),
      );
      expect(anulada.totales.igv).toBe(sumar(original.lineas.map((l) => l.igv)));
    }
  });

  it('con líneas gratuitas: la anulación las incluye sin sumar al total y la devolución las rechaza', () => {
    const rnd = semilla(99_001);
    for (let n = 0; n < ITERACIONES; n++) {
      const original = originalAlAzar(rnd, true);
      const gratuita = original.lineas.find((l) => l.gratuita)!;
      const anulada = valida(calcularNotaCredito(original, [], ANULACION));
      const suya = anulada.lineas.find((l) => l.posicionOrigen === gratuita.posicion)!;
      expect(suya).toMatchObject({
        gratuita: true,
        neto: '0.00',
        valorReferencial: gratuita.valorReferencial,
        baseReferencial: gratuita.baseReferencial,
        igvReferencial: gratuita.igvReferencial,
      });
      expect(anulada.totales.igvGratuitas).toBe(gratuita.igvReferencial);
      expect(anulada.totales.total).toBe(
        dos(
          original.lineas
            .filter((l) => !l.gratuita)
            .reduce((s, l) => s.plus(l.neto).plus(l.icbper), new D(0)),
        ),
      );
      expect(calcularNotaCredito(original, [], devolucion([gratuita.posicion, 1]))).toEqual({
        valida: false,
        codigo: 'NOTA_CREDITO_INVALIDA',
      });
    }
  });
});

// ------------------------------------------------------------------------------------------------
describe('esperadoDelTurno · criterio 136 (con `medio`) y criterio 22 (sin él)', () => {
  const monto = (esperado: readonly MontoPorMedio[], medio: string): string =>
    esperado.find((e) => e.medio === medio)!.monto;

  it('el ejemplo del criterio 136: efectivo 241.20 y Yape 60.20', () => {
    // Fondo 200.00; cuenta C en efectivo (69.20); nota de 1 Lomo devuelta en efectivo (28.00) y otra de 1 Gaseosa devuelta
    // por Yape (9.00) de una boleta pagada con Yape (69.20).
    const esperado = esperadoDelTurno({
      fondo: '200.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '69.20' },
        { medio: 'YAPE', monto: '69.20' },
      ],
      movimientos: [
        { tipo: 'EGRESO', monto: '28.00', medio: 'EFECTIVO' },
        { tipo: 'EGRESO', monto: '9.00', medio: 'YAPE' },
      ],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('241.20');
    expect(monto(esperado, 'YAPE')).toBe('60.20');
    for (const medio of ['TARJETA_CREDITO', 'TARJETA_DEBITO', 'PLIN']) {
      expect(monto(esperado, medio)).toBe('0.00');
    }
  });

  it('un egreso sin `medio` es de efectivo, igual que uno con `medio: EFECTIVO`', () => {
    const base = {
      fondo: '100.00',
      pagos: [{ medio: 'EFECTIVO', monto: '50.00' }] as MontoPorMedio[],
    };
    const sin = esperadoDelTurno({
      ...base,
      movimientos: [{ tipo: 'EGRESO', monto: '15.50' }],
    });
    const con = esperadoDelTurno({
      ...base,
      movimientos: [{ tipo: 'EGRESO', monto: '15.50', medio: 'EFECTIVO' }],
    });
    expect(sin).toEqual(con);
    expect(monto(sin, 'EFECTIVO')).toBe('134.50');
  });

  it('el egreso de un medio no efectivo no toca el efectivo y resta de su propio medio', () => {
    const esperado = esperadoDelTurno({
      fondo: '50.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '20.00' },
        { medio: 'TARJETA_CREDITO', monto: '40.00' },
        { medio: 'PLIN', monto: '12.00' },
      ],
      movimientos: [
        { tipo: 'EGRESO', monto: '15.00', medio: 'TARJETA_CREDITO' },
        { tipo: 'EGRESO', monto: '2.50', medio: 'PLIN' },
        { tipo: 'EGRESO', monto: '1.00', medio: 'PLIN' },
      ],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('70.00');
    expect(monto(esperado, 'TARJETA_CREDITO')).toBe('25.00');
    expect(monto(esperado, 'PLIN')).toBe('8.50');
    expect(monto(esperado, 'YAPE')).toBe('0.00');
  });

  it('un egreso de efectivo con `medio` se combina con los ingresos y egresos de efectivo sin él', () => {
    const esperado = esperadoDelTurno({
      fondo: '200.00',
      pagos: [],
      movimientos: [
        { tipo: 'INGRESO', monto: '20.00' },
        { tipo: 'EGRESO', monto: '15.50' },
        { tipo: 'EGRESO', monto: '28.00', medio: 'EFECTIVO' },
      ],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('176.50');
  });

  it('un medio fuera del catálogo en un movimiento es RangeError', () => {
    expect(() =>
      esperadoDelTurno({
        fondo: '0.00',
        pagos: [],
        movimientos: [{ tipo: 'EGRESO', monto: '1.00', medio: 'BITCOIN' as never }],
      }),
    ).toThrow(RangeError);
  });

  it('criterio 22 sin `medio`: fondo 200.00, efectivo 33.30 y 50.00, Yape 34.60, ingreso 20.00 y egreso 15.50 → efectivo 287.80, Yape 34.60', () => {
    const esperado = esperadoDelTurno({
      fondo: '200.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '33.30' },
        { medio: 'EFECTIVO', monto: '50.00' },
        { medio: 'YAPE', monto: '34.60' },
      ],
      movimientos: [
        { tipo: 'INGRESO', monto: '20.00' },
        { tipo: 'EGRESO', monto: '15.50' },
      ],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('287.80');
    expect(monto(esperado, 'YAPE')).toBe('34.60');
    expect(monto(esperado, 'TARJETA_CREDITO')).toBe('0.00');
    expect(monto(esperado, 'TARJETA_DEBITO')).toBe('0.00');
    expect(monto(esperado, 'PLIN')).toBe('0.00');
  });
});
