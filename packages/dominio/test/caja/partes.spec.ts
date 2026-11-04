// spec: 006-caja-cobro (pruebas protegidas)
//
// P1 · Criterios 8 y 17 a 20 (reglas puras de montos): `calcularParte` por ítems (17), en partes iguales (18), sus
// reglas y errores (19) y `cambioDeCuentaPermitido` (20). Cada ejemplo de la especificación, y una prueba de
// propiedad con semilla fija: para cuentas y divisiones al azar, la suma de las partes es el total de la cuenta y
// ninguna parte queda negativa.
import { describe, expect, it } from 'vitest';
import {
  calcularCuenta,
  calcularParte,
  cambioDeCuentaPermitido,
  type CuentaEntrada,
  type FormatoComprobante,
  type ParteCalculada,
  type ParteEntrada,
} from '../../src';
import {
  ID,
  cuentaC,
  cuentaUnaLinea,
  entero,
  generarCuenta,
  lineaBolsa,
  lineaGaseosa,
  lineaLomo,
  lineaMandarina,
  semilla,
  sumar,
  tomar,
  uuid,
  verificarParte,
} from './ayudas';

const conDescuento5 = (): CuentaEntrada => cuentaC({ descuentoCuenta: { tipo: 'MONTO', valor: '5.00' } });

const parteDe = (
  cuenta: CuentaEntrada,
  anteriores: readonly ParteCalculada[],
  parte: ParteEntrada,
  formato: FormatoComprobante = 'DETALLADO',
): ParteCalculada => tomar(calcularParte(cuenta, anteriores, parte, formato));

const linea = (p: ParteCalculada, itemId: string | null, afectacion?: string) => {
  const l = p.lineas.find((x) => x.itemId === itemId && (afectacion === undefined || x.afectacion === afectacion));
  if (!l) throw new Error(`Falta la línea ${itemId} ${afectacion ?? ''}`);
  return l;
};

describe('calcularParte por ítems · criterio 17', () => {
  it('1 de los 2 Lomos con el descuento de S/ 5.00: neto 25.95 (51.89 / 2 = 25.945)', () => {
    const p = parteDe(conDescuento5(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(p.tipo).toBe('ITEMS');
    expect(p.formato).toBe('DETALLADO');
    expect(p.lineas).toHaveLength(1);
    expect(p.lineas[0]).toMatchObject({
      itemId: ID.lomo,
      cantidad: 1,
      afectacion: 'GRAVADO',
      bruto: '28.00',
      descuento: '2.05',
      neto: '25.95',
      base: '21.99',
      igv: '3.96',
      bolsas: 0,
      icbper: '0.00',
      gratuita: null,
    });
    expect(p.porItem).toEqual([{ itemId: ID.lomo, cantidad: 1, neto: '25.95', bolsas: 0 }]);
    expect(p.totales).toMatchObject({
      subtotal: '28.00',
      descuentos: '2.05',
      operaciones: { gravadas: '21.99', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '3.96',
      icbper: '0.00',
      total: '25.95',
    });
    expect(p.cierraLaCuenta).toBe(false);
    verificarParte(p);
  });

  it('la parte siguiente que toma el otro Lomo cobra 25.94', () => {
    const cuenta = conDescuento5();
    const p1 = parteDe(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    const p2 = parteDe(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(p2.lineas[0]).toMatchObject({ bruto: '28.00', descuento: '2.06', neto: '25.94', base: '21.98', igv: '3.96' });
    expect(p2.totales.total).toBe('25.94');
    expect(sumar([p1.totales.total, p2.totales.total])).toBe('51.89');
    verificarParte(p2);
  });

  it('sin descuento, 1 Lomo = 28.00', () => {
    const p = parteDe(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(p.lineas[0]).toMatchObject({
      bruto: '28.00',
      descuento: '0.00',
      neto: '28.00',
      base: '23.73',
      igv: '4.27',
    });
    expect(p.totales.total).toBe('28.00');
  });

  it('si toma todas las unidades que faltan, el neto es exactamente el que falta', () => {
    const p = parteDe(conDescuento5(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 2 }] });
    expect(p.lineas[0]).toMatchObject({ bruto: '56.00', descuento: '4.11', neto: '51.89' });
  });

  it('una bolsa lleva su neto, su base y su ICBPER por bolsa', () => {
    const p = parteDe(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.bolsa, cantidad: 1 }] });
    expect(p.lineas[0]).toMatchObject({
      itemId: ID.bolsa,
      cantidad: 1,
      bruto: '0.10',
      neto: '0.10',
      base: '0.08',
      igv: '0.02',
      bolsas: 1,
      icbper: '0.50',
    });
    expect(p.porItem).toEqual([{ itemId: ID.bolsa, cantidad: 1, neto: '0.10', bolsas: 1 }]);
    expect(p.totales).toMatchObject({ icbper: '0.50', total: '0.60' });
  });

  it('cuenta C: parte 1 = 1 Lomo + 1 Gaseosa (37.00) y parte 2 = TOTAL (32.20), que cierra la cuenta', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], {
      tipo: 'ITEMS',
      items: [
        { itemId: ID.lomo, cantidad: 1 },
        { itemId: ID.gaseosa, cantidad: 1 },
      ],
    });
    expect(p1.totales).toMatchObject({
      subtotal: '37.00',
      descuentos: '0.00',
      operaciones: { gravadas: '31.36', exoneradas: '0.00' },
      igv: '5.64',
      icbper: '0.00',
      total: '37.00',
    });
    expect(p1.porItem).toHaveLength(2);
    expect(p1.porItem).toEqual(
      expect.arrayContaining([
        { itemId: ID.lomo, cantidad: 1, neto: '28.00', bolsas: 0 },
        { itemId: ID.gaseosa, cantidad: 1, neto: '9.00', bolsas: 0 },
      ]),
    );
    expect(p1.cierraLaCuenta).toBe(false);

    const p2 = parteDe(cuenta, [p1], { tipo: 'TOTAL' });
    expect(p2.tipo).toBe('TOTAL');
    expect(p2.totales).toMatchObject({
      subtotal: '31.20',
      descuentos: '0.00',
      operaciones: { gravadas: '23.90', exoneradas: '3.00' },
      igv: '4.30',
      icbper: '1.00',
      total: '32.20',
    });
    expect(p2.porItem).toHaveLength(3);
    expect(p2.porItem).toEqual(
      expect.arrayContaining([
        { itemId: ID.lomo, cantidad: 1, neto: '28.00', bolsas: 0 },
        { itemId: ID.bolsa, cantidad: 2, neto: '0.20', bolsas: 2 },
        { itemId: ID.mandarina, cantidad: 1, neto: '3.00', bolsas: 0 },
      ]),
    );
    expect(p2.cierraLaCuenta).toBe(true);
    verificarParte(p1);
    verificarParte(p2);
  });

  it('TOTAL sin partes anteriores es toda la cuenta C, línea por línea, y cierra la cuenta', () => {
    const p = parteDe(cuentaC(), [], { tipo: 'TOTAL' });
    expect(p.lineas).toHaveLength(4);
    expect(linea(p, ID.lomo)).toMatchObject({ cantidad: 2, bruto: '56.00', neto: '56.00', base: '47.46', igv: '8.54' });
    expect(linea(p, ID.gaseosa)).toMatchObject({ cantidad: 1, neto: '9.00', base: '7.63', igv: '1.37' });
    expect(linea(p, ID.bolsa)).toMatchObject({ cantidad: 2, neto: '0.20', bolsas: 2, icbper: '1.00' });
    expect(linea(p, ID.mandarina)).toMatchObject({ cantidad: 1, neto: '3.00', base: '3.00', igv: '0.00' });
    expect(p.totales).toMatchObject({
      subtotal: '68.20',
      descuentos: '0.00',
      operaciones: { gravadas: '55.26', exoneradas: '3.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '9.94',
      icbper: '1.00',
      total: '69.20',
    });
    expect(p.cierraLaCuenta).toBe(true);
    verificarParte(p);
  });

  it('tomar todo lo que falta por ítems también cierra la cuenta', () => {
    const p = parteDe(cuentaC(), [], {
      tipo: 'ITEMS',
      items: [
        { itemId: ID.lomo, cantidad: 2 },
        { itemId: ID.gaseosa, cantidad: 1 },
        { itemId: ID.bolsa, cantidad: 2 },
        { itemId: ID.mandarina, cantidad: 1 },
      ],
    });
    expect(p.totales.total).toBe('69.20');
    expect(p.cierraLaCuenta).toBe(true);
  });

  it('en Nuevo RUS la parte no lleva IGV', () => {
    const p = parteDe(cuentaC({ tasaIgv: null }), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(p.lineas[0]).toMatchObject({ neto: '28.00', base: '28.00', igv: '0.00' });
    expect(p.totales.igv).toBe('0.00');
    expect(p.totales.operaciones).toBeNull();
  });

  describe('formato CONSUMO', () => {
    const lomoYGaseosa: ParteEntrada = {
      tipo: 'ITEMS',
      items: [
        { itemId: ID.lomo, cantidad: 2 },
        { itemId: ID.gaseosa, cantidad: 1 },
      ],
    };

    it('ejemplo del criterio 17: Lomo × 2 + Gaseosa × 1 agrupados en una línea Por consumo', () => {
      const p = parteDe(cuentaC(), [], lomoYGaseosa, 'CONSUMO');
      expect(p.formato).toBe('CONSUMO');
      expect(p.lineas).toEqual([
        {
          itemId: null,
          cantidad: 1,
          afectacion: 'GRAVADO',
          bruto: '65.00',
          descuento: '0.00',
          neto: '65.00',
          base: '55.08',
          igv: '9.92',
          bolsas: 0,
          icbper: '0.00',
          gratuita: null,
        },
      ]);
      expect(p.totales).toEqual({
        subtotal: '65.00',
        descuentos: '0.00',
        operaciones: { gravadas: '55.08', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
        igv: '9.92',
        igvGratuitas: '0.00',
        icbper: '0.00',
        total: '65.00',
      });
      verificarParte(p);
    });

    it('la misma parte en DETALLADO da dos líneas y cambia el IGV por céntimos, no el total', () => {
      const p = parteDe(cuentaC(), [], lomoYGaseosa, 'DETALLADO');
      expect(p.lineas).toHaveLength(2);
      expect(linea(p, ID.lomo)).toMatchObject({ cantidad: 2, bruto: '56.00', neto: '56.00', base: '47.46', igv: '8.54' });
      expect(linea(p, ID.gaseosa)).toMatchObject({ cantidad: 1, neto: '9.00', base: '7.63', igv: '1.37' });
      expect(p.totales).toMatchObject({ total: '65.00', igv: '9.91', operaciones: { gravadas: '55.09' } });
      verificarParte(p);
    });

    it('cuenta C entera con TOTAL: Por consumo gravado, Por consumo exonerado y la bolsa detallada, en ese orden', () => {
      const p = parteDe(cuentaC(), [], { tipo: 'TOTAL' }, 'CONSUMO');
      expect(p.lineas).toEqual([
        {
          itemId: null,
          cantidad: 1,
          afectacion: 'GRAVADO',
          bruto: '65.00',
          descuento: '0.00',
          neto: '65.00',
          base: '55.08',
          igv: '9.92',
          bolsas: 0,
          icbper: '0.00',
          gratuita: null,
        },
        {
          itemId: null,
          cantidad: 1,
          afectacion: 'EXONERADO',
          bruto: '3.00',
          descuento: '0.00',
          neto: '3.00',
          base: '3.00',
          igv: '0.00',
          bolsas: 0,
          icbper: '0.00',
          gratuita: null,
        },
        {
          itemId: ID.bolsa,
          cantidad: 2,
          afectacion: 'GRAVADO',
          bruto: '0.20',
          descuento: '0.00',
          neto: '0.20',
          base: '0.17',
          igv: '0.03',
          bolsas: 2,
          icbper: '1.00',
          gratuita: null,
        },
      ]);
      expect(p.totales).toMatchObject({
        operaciones: { gravadas: '55.25', exoneradas: '3.00', inafectas: '0.00' },
        igv: '9.95',
        icbper: '1.00',
        total: '69.20',
      });
      verificarParte(p);
    });

    it('las afectaciones agrupadas van en el orden GRAVADO, EXONERADO, INAFECTO', () => {
      const cuenta: CuentaEntrada = {
        ...cuentaC(),
        lineas: [
          lineaMandarina({ itemId: uuid(7), afectacion: 'INAFECTO', precioUnitario: '2.00' }),
          lineaMandarina(),
          lineaLomo(),
        ],
      };
      const p = parteDe(cuenta, [], { tipo: 'TOTAL' }, 'CONSUMO');
      expect(p.lineas.map((l) => l.afectacion)).toEqual(['GRAVADO', 'EXONERADO', 'INAFECTO']);
      expect(p.lineas.every((l) => l.itemId === null)).toBe(true);
    });

    it('solo aparecen las afectaciones con neto mayor que cero en la parte', () => {
      const p = parteDe(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.mandarina, cantidad: 1 }] }, 'CONSUMO');
      expect(p.lineas).toHaveLength(1);
      expect(p.lineas[0]).toMatchObject({ itemId: null, afectacion: 'EXONERADO', neto: '3.00' });
    });

    it('porItem es el mismo en DETALLADO y en CONSUMO (dice qué se lleva cada ítem)', () => {
      const items = [
        { itemId: ID.lomo, cantidad: 1 },
        { itemId: ID.gaseosa, cantidad: 1 },
        { itemId: ID.bolsa, cantidad: 1 },
      ];
      const detallado = parteDe(conDescuento5(), [], { tipo: 'ITEMS', items }, 'DETALLADO');
      const consumo = parteDe(conDescuento5(), [], { tipo: 'ITEMS', items }, 'CONSUMO');
      expect(consumo.porItem).toEqual(detallado.porItem);
      expect(consumo.porItem).toHaveLength(3);
      expect(consumo.totales.total).toBe(detallado.totales.total);
      verificarParte(consumo);
    });

    it('con descuento, la línea agrupada suma bruto, descuento y neto y se desglosa sobre la suma', () => {
      const p = parteDe(conDescuento5(), [], lomoYGaseosa, 'CONSUMO');
      expect(p.lineas).toEqual([
        {
          itemId: null,
          cantidad: 1,
          afectacion: 'GRAVADO',
          bruto: '65.00',
          descuento: '4.77',
          neto: '60.23',
          base: '51.04',
          igv: '9.19',
          bolsas: 0,
          icbper: '0.00',
          gratuita: null,
        },
      ]);
      expect(p.totales.total).toBe('60.23');
    });
  });

  describe('cortesías', () => {
    const conCortesia = (): CuentaEntrada =>
      cuentaC({
        lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2, cantidadCortesia: 1 }), lineaBolsa(), lineaMandarina()],
      });
    const lineaGratuita = {
      itemId: ID.gaseosa,
      cantidad: 1,
      afectacion: 'GRAVADO',
      bruto: '0.00',
      descuento: '0.00',
      neto: '0.00',
      base: '0.00',
      igv: '0.00',
      bolsas: 0,
      icbper: '0.00',
      gratuita: { cantidad: 1, valorReferencial: '9.00', base: '7.63', igv: '1.37' },
    };

    it('salen como una línea gratuita propia, al final, en la primera parte que se cobra y no en las siguientes', () => {
      const cuenta = conCortesia();
      const p1 = parteDe(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
      expect(p1.lineas).toHaveLength(2);
      expect(p1.lineas[0]).toMatchObject({ itemId: ID.lomo, gratuita: null });
      expect(p1.lineas[1]).toEqual(lineaGratuita);
      expect(p1.porItem).toEqual([{ itemId: ID.lomo, cantidad: 1, neto: '28.00', bolsas: 0 }]);
      expect(p1.totales.operaciones?.gratuitas).toBe('7.63');
      expect(p1.totales.igvGratuitas).toBe('1.37');
      expect(p1.totales.total).toBe('28.00');
      verificarParte(p1);

      const p2 = parteDe(cuenta, [p1], { tipo: 'TOTAL' });
      expect(p2.lineas.filter((l) => l.gratuita !== null)).toHaveLength(0);
      expect(p2.totales.operaciones?.gratuitas).toBe('0.00');
      expect(p2.totales.igvGratuitas).toBe('0.00');
      // 1 Lomo (28.00) + 1 Gaseosa cobrable (9.00) + 2 bolsas (0.20 + 1.00) + Mandarina (3.00)
      expect(p2.totales.total).toBe('41.20');
      expect(sumar([p1.totales.total, p2.totales.total])).toBe('69.20');
      verificarParte(p2);
    });

    it('la unidad cobrada del mismo ítem va en su propia línea cobrada, separada de la gratuita', () => {
      const p = parteDe(conCortesia(), [], { tipo: 'TOTAL' });
      const delItem = p.lineas.filter((l) => l.itemId === ID.gaseosa);
      expect(delItem).toHaveLength(2);
      expect(delItem[0]).toMatchObject({ cantidad: 1, bruto: '9.00', gratuita: null });
      expect(delItem[1]).toEqual(lineaGratuita);
      expect(p.lineas[p.lineas.length - 1]).toEqual(lineaGratuita);
      expect(p.porItem.find((x) => x.itemId === ID.gaseosa)).toEqual({
        itemId: ID.gaseosa,
        cantidad: 1,
        neto: '9.00',
        bolsas: 0,
      });
      verificarParte(p);
    });

    it('con formato CONSUMO las gratuitas siguen detalladas y van al final', () => {
      const p = parteDe(conCortesia(), [], { tipo: 'TOTAL' }, 'CONSUMO');
      expect(p.lineas[p.lineas.length - 1]).toEqual(lineaGratuita);
      expect(p.lineas.filter((l) => l.gratuita !== null)).toHaveLength(1);
      verificarParte(p);
    });

    it('tomar por ítems todo lo cobrable en la primera parte, con cortesías, cierra la cuenta', () => {
      const p = parteDe(conCortesia(), [], {
        tipo: 'ITEMS',
        items: [
          { itemId: ID.lomo, cantidad: 2 },
          { itemId: ID.gaseosa, cantidad: 1 },
          { itemId: ID.bolsa, cantidad: 2 },
          { itemId: ID.mandarina, cantidad: 1 },
        ],
      });
      expect(p.totales.total).toBe('69.20');
      expect(p.cierraLaCuenta).toBe(true);
    });

    it('con cortesías pendientes, una selección vacía es válida y cobra solo las gratuitas (total 0.00)', () => {
      const cuenta = conCortesia();
      const p = parteDe(cuenta, [], { tipo: 'ITEMS', items: [] });
      expect(p.lineas).toEqual([lineaGratuita]);
      expect(p.porItem).toEqual([]);
      expect(p.totales.total).toBe('0.00');
      expect(p.cierraLaCuenta).toBe(false);
      // ya no hay cortesías pendientes: otra selección vacía es PARTE_INVALIDA
      expect(calcularParte(cuenta, [p], { tipo: 'ITEMS', items: [] }, 'DETALLADO')).toEqual({
        valida: false,
        codigo: 'PARTE_INVALIDA',
      });
    });

    it('una cuenta toda en cortesía se cobra con TOTAL: solo líneas gratuitas, total 0.00, y la cierra', () => {
      const cuenta = cuentaUnaLinea('9.00', { cantidadCortesia: 1 });
      const p = parteDe(cuenta, [], { tipo: 'TOTAL' });
      expect(p.lineas).toHaveLength(1);
      expect(p.lineas[0]).toMatchObject({
        itemId: ID.lomo,
        cantidad: 1,
        bruto: '0.00',
        neto: '0.00',
        gratuita: { cantidad: 1, valorReferencial: '9.00', base: '7.63', igv: '1.37' },
      });
      expect(p.porItem).toEqual([]);
      expect(p.totales.total).toBe('0.00');
      expect(p.cierraLaCuenta).toBe(true);
    });
  });
});

describe('calcularParte en partes iguales · criterio 18', () => {
  const iguales = (r: number): ParteEntrada => ({ tipo: 'IGUALES', partesRestantes: r });

  it('saldo 100.00 todo gravado en 3 partes: 33.34, 33.33 y 33.33', () => {
    const cuenta = cuentaUnaLinea('100.00');
    const p1 = parteDe(cuenta, [], iguales(3), 'CONSUMO');
    const p2 = parteDe(cuenta, [p1], iguales(2), 'CONSUMO');
    const p3 = parteDe(cuenta, [p1, p2], iguales(1), 'CONSUMO');

    expect(p1.totales).toMatchObject({ total: '33.34', igv: '5.09' });
    expect(p2.totales).toMatchObject({ total: '33.33', igv: '5.08' });
    expect(p3.totales).toMatchObject({ total: '33.33', igv: '5.08' });
    for (const p of [p1, p2, p3]) {
      expect(p.tipo).toBe('IGUALES');
      expect(p.formato).toBe('CONSUMO');
      expect(p.totales.operaciones?.gravadas).toBe('28.25');
      expect(linea(p, null, 'GRAVADO').base).toBe('28.25');
      verificarParte(p);
    }
    expect(linea(p1, null, 'GRAVADO')).toMatchObject({ neto: '33.34', igv: '5.09' });
    expect([p1.cierraLaCuenta, p2.cierraLaCuenta, p3.cierraLaCuenta]).toEqual([false, false, true]);
    // se omiten las afectaciones a las que la parte no les toca nada
    for (const p of [p1, p2, p3]) {
      expect(p.lineas).toHaveLength(1);
      expect(p.lineas[0]).toMatchObject({ itemId: null, afectacion: 'GRAVADO', bruto: p.totales.total, descuento: '0.00' });
    }
  });

  it('el céntimo se redondea hacia arriba: 10.00 en 3 da 3.34, 3.33 y 3.33; 0.10 en 3 da 0.04, 0.03 y 0.03', () => {
    for (const [total, esperadas] of [
      ['10.00', ['3.34', '3.33', '3.33']],
      ['0.10', ['0.04', '0.03', '0.03']],
      ['10.01', ['3.34', '3.34', '3.33']],
    ] as const) {
      const cuenta = cuentaUnaLinea(total);
      const partes: ParteCalculada[] = [];
      for (const r of [3, 2, 1]) partes.push(parteDe(cuenta, partes, iguales(r), 'CONSUMO'));
      expect(partes.map((p) => p.totales.total)).toEqual(esperadas);
      expect(sumar(partes.map((p) => p.totales.total))).toBe(total);
    }
  });

  it('con una sola parte restante (r = 1) toma todo el saldo', () => {
    const cuenta = cuentaC();
    const p = parteDe(cuenta, [], iguales(1), 'CONSUMO');
    expect(p.totales.total).toBe('69.20');
    expect(p.cierraLaCuenta).toBe(true);
    expect(linea(p, ID.bolsa)).toMatchObject({ cantidad: 2, bolsas: 2, icbper: '1.00' });
  });

  it('cuenta C en 2 partes: cada una 34.60 con su consumo, su bolsa y su ICBPER', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], iguales(2), 'CONSUMO');
    const p2 = parteDe(cuenta, [p1], iguales(1), 'CONSUMO');

    for (const p of [p1, p2]) {
      expect(p.formato).toBe('CONSUMO');
      expect(p.totales).toEqual({
        subtotal: '34.10',
        descuentos: '0.00',
        operaciones: { gravadas: '27.62', exoneradas: '1.50', inafectas: '0.00', gratuitas: '0.00' },
        igv: '4.98',
        igvGratuitas: '0.00',
        icbper: '0.50',
        total: '34.60',
      });
      expect(p.lineas.map((l) => [l.itemId, l.afectacion])).toEqual([
        [null, 'GRAVADO'],
        [null, 'EXONERADO'],
        [ID.bolsa, 'GRAVADO'],
      ]);
      expect(linea(p, null, 'GRAVADO')).toMatchObject({ cantidad: 1, bruto: '32.50', descuento: '0.00', bolsas: 0, icbper: '0.00', gratuita: null });
      expect(linea(p, null, 'EXONERADO')).toMatchObject({ cantidad: 1, bruto: '1.50', descuento: '0.00' });
      expect(linea(p, ID.bolsa)).toMatchObject({ bruto: '0.10', descuento: '0.00', gratuita: null });
      expect(linea(p, null, 'GRAVADO')).toMatchObject({ neto: '32.50', base: '27.54', igv: '4.96' });
      expect(linea(p, null, 'EXONERADO')).toMatchObject({ neto: '1.50', base: '1.50', igv: '0.00' });
      expect(linea(p, ID.bolsa)).toMatchObject({
        cantidad: 1,
        neto: '0.10',
        base: '0.08',
        igv: '0.02',
        bolsas: 1,
        icbper: '0.50',
      });
      expect(p.porItem).toEqual([{ itemId: ID.bolsa, cantidad: 1, neto: '0.10', bolsas: 1 }]);
      verificarParte(p);
    }
    expect(p1.cierraLaCuenta).toBe(false);
    expect(p2.cierraLaCuenta).toBe(true);
    // El IGV de las partes (9.96) puede diferir por céntimos del de la cuenta sin dividir (9.94); el total cuadra.
    expect(sumar([p1.totales.igv, p2.totales.igv])).toBe('9.96');
    expect(sumar([p1.totales.total, p2.totales.total])).toBe('69.20');
  });

  it('por ítems primero y partes iguales después: 37.00 y luego dos partes de 16.10', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], {
      tipo: 'ITEMS',
      items: [
        { itemId: ID.lomo, cantidad: 1 },
        { itemId: ID.gaseosa, cantidad: 1 },
      ],
    });
    const p2 = parteDe(cuenta, [p1], iguales(2), 'CONSUMO');
    const p3 = parteDe(cuenta, [p1, p2], iguales(1), 'CONSUMO');
    for (const p of [p2, p3]) {
      expect(p.totales).toMatchObject({ total: '16.10', icbper: '0.50' });
      expect(linea(p, null, 'GRAVADO')).toMatchObject({ neto: '14.00', base: '11.86', igv: '2.14' });
      expect(linea(p, null, 'EXONERADO')).toMatchObject({ neto: '1.50', base: '1.50', igv: '0.00' });
      expect(linea(p, ID.bolsa)).toMatchObject({ cantidad: 1, neto: '0.10', bolsas: 1, icbper: '0.50' });
    }
    expect(p2.cierraLaCuenta).toBe(false);
    expect(p3.cierraLaCuenta).toBe(true);
  });

  it('con afectaciones mixtas, el consumo se reparte por mayor resto y la última toma lo que falta de cada una', () => {
    // Gravado 10.00 + exonerado 5.01 = 15.01 en 3 partes: 5.01, 5.00 y 5.00
    const cuenta: CuentaEntrada = {
      ...cuentaC(),
      lineas: [lineaLomo({ cantidad: 1, precioUnitario: '10.00' }), lineaMandarina({ precioUnitario: '5.01' })],
    };
    const p1 = parteDe(cuenta, [], iguales(3), 'CONSUMO');
    const p2 = parteDe(cuenta, [p1], iguales(2), 'CONSUMO');
    const p3 = parteDe(cuenta, [p1, p2], iguales(1), 'CONSUMO');
    expect([p1, p2, p3].map((p) => p.totales.total)).toEqual(['5.01', '5.00', '5.00']);
    expect([p1, p2, p3].map((p) => linea(p, null, 'GRAVADO').neto)).toEqual(['3.34', '3.33', '3.33']);
    expect([p1, p2, p3].map((p) => linea(p, null, 'EXONERADO').neto)).toEqual(['1.67', '1.67', '1.67']);
    expect(sumar([p1, p2, p3].map((p) => linea(p, null, 'GRAVADO').neto))).toBe('10.00');
    expect(sumar([p1, p2, p3].map((p) => linea(p, null, 'EXONERADO').neto))).toBe('5.01');
    expect(p3.cierraLaCuenta).toBe(true);
  });
});

describe('calcularParte · reglas y errores · criterio 19', () => {
  const invalida = { valida: false, codigo: 'PARTE_INVALIDA' } as const;

  it('un ítem que no existe en la cuenta es PARTE_INVALIDA', () => {
    expect(calcularParte(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: uuid(99), cantidad: 1 }] }, 'DETALLADO')).toEqual(invalida);
  });

  it('un ítem repetido en la selección es PARTE_INVALIDA', () => {
    const items = [
      { itemId: ID.lomo, cantidad: 1 },
      { itemId: ID.lomo, cantidad: 1 },
    ];
    expect(calcularParte(cuentaC(), [], { tipo: 'ITEMS', items }, 'DETALLADO')).toEqual(invalida);
  });

  it('pedir más unidades de las que faltan es PARTE_INVALIDA', () => {
    expect(calcularParte(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 3 }] }, 'DETALLADO')).toEqual(invalida);
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 2 }] }, 'DETALLADO')).toEqual(invalida);
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] }, 'DETALLADO')).toMatchObject({ valida: true });
  });

  it('una unidad en cortesía no se puede pedir para cobrar', () => {
    const cuenta = cuentaC({
      lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2, cantidadCortesia: 1 }), lineaBolsa(), lineaMandarina()],
    });
    expect(calcularParte(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: ID.gaseosa, cantidad: 2 }] }, 'DETALLADO')).toEqual(invalida);
  });

  it('después de una parte igual solo vale otra parte igual (por ítems y TOTAL son PARTE_INVALIDA)', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'IGUALES', partesRestantes: 3 }, 'CONSUMO');
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.mandarina, cantidad: 1 }] }, 'DETALLADO')).toEqual(invalida);
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.mandarina, cantidad: 1 }] }, 'CONSUMO')).toEqual(invalida);
    expect(calcularParte(cuenta, [p1], { tipo: 'TOTAL' }, 'CONSUMO')).toEqual(invalida);
    expect(calcularParte(cuenta, [p1], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO')).toMatchObject({ valida: true });
    expect(calcularParte(cuenta, [p1], { tipo: 'IGUALES', partesRestantes: 1 }, 'CONSUMO')).toMatchObject({ valida: true });
  });

  it('por ítems y después iguales sí vale', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(calcularParte(cuenta, [p1], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO')).toMatchObject({ valida: true });
  });

  it('el formato DETALLADO en partes iguales es PARTE_INVALIDA', () => {
    expect(calcularParte(cuentaC(), [], { tipo: 'IGUALES', partesRestantes: 2 }, 'DETALLADO')).toEqual(invalida);
  });

  it('una selección vacía sin cortesías pendientes es PARTE_INVALIDA', () => {
    expect(calcularParte(cuentaC(), [], { tipo: 'ITEMS', items: [] }, 'DETALLADO')).toEqual(invalida);
  });

  it('con el saldo en 0.00 y sin unidades ni cortesías por cobrar es NADA_QUE_COBRAR', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'TOTAL' });
    expect(calcularParte(cuenta, [p1], { tipo: 'TOTAL' }, 'DETALLADO')).toEqual({
      valida: false,
      codigo: 'NADA_QUE_COBRAR',
    });
  });

  it('si el consumo de una parte igual sale negativo (las bolsas pesan más que la parte), PARTE_INVALIDA', () => {
    // 10 bolsas: neto 1.00 + ICBPER 5.00 = 6.00 en 50 partes (0.12 cada una) pero cada parte lleva al menos 1 bolsa (0.60)
    const cuenta: CuentaEntrada = { ...cuentaC(), lineas: [lineaBolsa({ cantidad: 10 })] };
    expect(calcularParte(cuenta, [], { tipo: 'IGUALES', partesRestantes: 50 }, 'CONSUMO')).toEqual(invalida);
  });

  it('rechaza con RangeError las partes restantes fuera de 1 a 50 o no enteras (criterio 8)', () => {
    for (const r of [0, 51, 2.5, -1]) {
      expect(() => calcularParte(cuentaC(), [], { tipo: 'IGUALES', partesRestantes: r }, 'CONSUMO')).toThrow(RangeError);
    }
  });

  it('después de una parte igual que cerró la cuenta, cualquier parte nueva es NADA_QUE_COBRAR (no PARTE_INVALIDA)', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'IGUALES', partesRestantes: 1 }, 'CONSUMO');
    expect(p1.cierraLaCuenta).toBe(true);
    const nada = { valida: false, codigo: 'NADA_QUE_COBRAR' } as const;
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.mandarina, cantidad: 1 }] }, 'DETALLADO')).toEqual(nada);
    expect(calcularParte(cuenta, [p1], { tipo: 'TOTAL' }, 'DETALLADO')).toEqual(nada);
    expect(calcularParte(cuenta, [p1], { tipo: 'IGUALES', partesRestantes: 1 }, 'CONSUMO')).toEqual(nada);
    expect(calcularParte(cuenta, [p1], { tipo: 'IGUALES', partesRestantes: 2 }, 'DETALLADO')).toEqual(nada);
  });

  it('también es NADA_QUE_COBRAR después de cobrarlo todo por ítems, antes de revisar los ítems pedidos', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'TOTAL' });
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: uuid(99), cantidad: 1 }] }, 'DETALLADO')).toEqual({
      valida: false,
      codigo: 'NADA_QUE_COBRAR',
    });
    expect(calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [] }, 'DETALLADO')).toEqual({
      valida: false,
      codigo: 'NADA_QUE_COBRAR',
    });
  });

  it('el RangeError de la entrada se revisa antes que NADA_QUE_COBRAR', () => {
    const cuenta = cuentaC();
    const p1 = parteDe(cuenta, [], { tipo: 'TOTAL' });
    expect(() => calcularParte(cuenta, [p1], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 0 }] }, 'DETALLADO')).toThrow(RangeError);
  });

  it('en la selección, la cantidad 0 y la cantidad 1000 son RangeError (no PARTE_INVALIDA)', () => {
    for (const q of [0, 1000]) {
      expect(() => calcularParte(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: q }] }, 'DETALLADO')).toThrow(RangeError);
    }
  });

  it('una selección vacía (items: []) no es RangeError: es PARTE_INVALIDA sin cortesías pendientes', () => {
    expect(calcularParte(cuentaC(), [], { tipo: 'ITEMS', items: [] }, 'CONSUMO')).toEqual(invalida);
  });

  it('rechaza con RangeError una cuenta con dos líneas del mismo itemId', () => {
    const cuenta = cuentaC({ lineas: [lineaLomo(), lineaLomo()] });
    expect(() => calcularParte(cuenta, [], { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(RangeError);
  });

  it('rechaza con RangeError una línea con ICBPER y cortesía', () => {
    const cuenta = cuentaC({ lineas: [lineaLomo(), lineaBolsa({ cantidad: 3, cantidadCortesia: 1 })] });
    expect(() => calcularParte(cuenta, [], { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(RangeError);
  });

  it('rechaza con RangeError una cantidad no entera o negativa en la selección', () => {
    for (const q of [1.5, -1]) {
      expect(() => calcularParte(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: q }] }, 'DETALLADO')).toThrow(RangeError);
    }
  });

  it('rechaza con RangeError una cuenta con montos mal formados', () => {
    expect(() => calcularParte(cuentaC({ montoIcbper: 'x' }), [], { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(RangeError);
    expect(() => calcularParte(cuentaC({ tasaIgv: '31.00' }), [], { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(RangeError);
  });
});

describe('cambioDeCuentaPermitido · criterio 20', () => {
  const permitido = { permitido: true } as const;
  const noPermitido = { permitido: false, codigo: 'CUENTA_COBRADA_EN_PARTE' } as const;

  const lomoCobrado = (): ParteCalculada =>
    parteDe(cuentaC(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });

  it('sin partes anteriores todo cambio es permitido', () => {
    expect(cambioDeCuentaPermitido(cuentaC({ lineas: [lineaLomo(), lineaGaseosa({ cantidad: 3 })] }), [])).toEqual(permitido);
  });

  it('cuenta C sin descuento y 1 Lomo cobrado: enviar 1 Gaseosa más es permitido', () => {
    const nueva = cuentaC({
      lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2 }), lineaBolsa(), lineaMandarina()],
    });
    expect(cambioDeCuentaPermitido(nueva, [lomoCobrado()])).toEqual(permitido);
  });

  it('anular el Lomo que falta es permitido', () => {
    const nueva = cuentaC({
      lineas: [lineaLomo({ cantidad: 1 }), lineaGaseosa(), lineaBolsa(), lineaMandarina()],
    });
    expect(cambioDeCuentaPermitido(nueva, [lomoCobrado()])).toEqual(permitido);
  });

  it('anular los 2 Lomos no es permitido (uno ya está cobrado)', () => {
    const nueva = cuentaC({ lineas: [lineaGaseosa(), lineaBolsa(), lineaMandarina()] });
    expect(cambioDeCuentaPermitido(nueva, [lomoCobrado()])).toEqual(noPermitido);
  });

  it('anular una unidad ya cobrada de una línea cobrada entera no es permitido', () => {
    const cuenta = cuentaC();
    const dosLomos = parteDe(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 2 }] });
    const nueva = cuentaC({
      lineas: [lineaLomo({ cantidad: 1 }), lineaGaseosa(), lineaBolsa(), lineaMandarina()],
    });
    expect(cambioDeCuentaPermitido(nueva, [dosLomos])).toEqual(noPermitido);
  });

  it('con descuento por ítem (no por cuenta), enviar otro ítem sigue siendo permitido', () => {
    const base = cuentaC({
      lineas: [
        lineaLomo({ descuento: { tipo: 'PORCENTAJE', valor: '10' } }),
        lineaGaseosa(),
        lineaBolsa(),
        lineaMandarina(),
      ],
    });
    const p1 = parteDe(base, [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });
    expect(p1.totales.total).toBe('25.20');
    const nueva: CuentaEntrada = { ...base, lineas: [base.lineas[0]!, lineaGaseosa({ cantidad: 2 }), base.lineas[2]!, base.lineas[3]!] };
    expect(cambioDeCuentaPermitido(nueva, [p1])).toEqual(permitido);
  });

  describe('con descuento por cuenta y una parte cobrada (regla b)', () => {
    const cuentaConDescuento = (): CuentaEntrada => conDescuento5();
    const lomoCobradoConDescuento = (): ParteCalculada =>
      parteDe(cuentaConDescuento(), [], { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] });

    it('enviar 1 Gaseosa más no es permitido', () => {
      const nueva = cuentaC({
        descuentoCuenta: { tipo: 'MONTO', valor: '5.00' },
        lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2 }), lineaBolsa(), lineaMandarina()],
      });
      expect(cambioDeCuentaPermitido(nueva, [lomoCobradoConDescuento()])).toEqual(noPermitido);
    });

    it('anular la Mandarina no es permitido', () => {
      const nueva = cuentaC({
        descuentoCuenta: { tipo: 'MONTO', valor: '5.00' },
        lineas: [lineaLomo(), lineaGaseosa(), lineaBolsa()],
      });
      expect(cambioDeCuentaPermitido(nueva, [lomoCobradoConDescuento()])).toEqual(noPermitido);
    });

    it('sin cambios en las líneas tampoco es permitido: con una parte cobrada y descuento por cuenta, siempre no', () => {
      expect(cambioDeCuentaPermitido(cuentaConDescuento(), [lomoCobradoConDescuento()])).toEqual(noPermitido);
    });

    it('sin partes anteriores, el descuento por cuenta no impide cambios (regla a)', () => {
      const nueva = cuentaC({
        descuentoCuenta: { tipo: 'PORCENTAJE', valor: '10' },
        lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2 }), lineaBolsa(), lineaMandarina()],
      });
      expect(cambioDeCuentaPermitido(nueva, [])).toEqual(permitido);
    });

    it('con partes iguales cobradas y descuento por cuenta tampoco es permitido', () => {
      const cuenta = cuentaConDescuento();
      const p1 = parteDe(cuenta, [], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO');
      expect(cambioDeCuentaPermitido(cuenta, [p1])).toEqual(noPermitido);
    });
  });

  it('rechaza con RangeError una cuenta nueva con dos líneas del mismo itemId o con cortesía en una línea con ICBPER', () => {
    expect(() => cambioDeCuentaPermitido(cuentaC({ lineas: [lineaLomo(), lineaLomo()] }), [lomoCobrado()])).toThrow(RangeError);
    expect(() =>
      cambioDeCuentaPermitido(cuentaC({ lineas: [lineaLomo(), lineaBolsa({ cantidad: 3, cantidadCortesia: 1 })] }), [lomoCobrado()]),
    ).toThrow(RangeError);
    expect(() => cambioDeCuentaPermitido(cuentaC({ montoIcbper: 'x' }), [])).toThrow(RangeError);
  });

  describe('con partes iguales ya cobradas', () => {
    const unaDeDos = (): ParteCalculada =>
      parteDe(cuentaC(), [], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO');

    it('enviar el postre de los que se quedan (más consumo) es permitido', () => {
      const nueva = cuentaC({
        lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2 }), lineaBolsa(), lineaMandarina()],
      });
      expect(cambioDeCuentaPermitido(nueva, [unaDeDos()])).toEqual(permitido);
    });

    it('anular lo exonerado cuando ya se cobró parte de ello no es permitido (afectación en negativo)', () => {
      const nueva = cuentaC({ lineas: [lineaLomo(), lineaGaseosa(), lineaBolsa()] });
      expect(cambioDeCuentaPermitido(nueva, [unaDeDos()])).toEqual(noPermitido);
    });

    it('anular las bolsas cuando ya se cobró una no es permitido (bolsas en negativo)', () => {
      const nueva = cuentaC({ lineas: [lineaLomo(), lineaGaseosa(), lineaMandarina()] });
      expect(cambioDeCuentaPermitido(nueva, [unaDeDos()])).toEqual(noPermitido);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Propiedad: la suma de las partes es el total y ninguna parte queda negativa

describe('calcularParte · propiedad con semilla fija', () => {
  const formatoAlAzar = (rnd: () => number): FormatoComprobante => (rnd() < 0.5 ? 'DETALLADO' : 'CONSUMO');

  /** Lo común: las partes suman el total de la cuenta y reparten sus bolsas enteras; nada queda negativo. */
  function verificarReparto(cuenta: CuentaEntrada, partes: readonly ParteCalculada[]): void {
    const total = calcularCuenta(cuenta);
    for (const p of partes) verificarParte(p);
    expect(sumar(partes.map((p) => p.totales.total))).toBe(total.totales.total);
    expect(partes.map((p) => p.cierraLaCuenta)).toEqual(partes.map((_, i) => i === partes.length - 1));
    const bolsasCuenta = total.lineas.reduce((acc, l) => acc + l.bolsas, 0);
    const bolsasPartes = partes.reduce((acc, p) => acc + p.porItem.reduce((a, i) => a + i.bolsas, 0), 0);
    expect(bolsasPartes).toBe(bolsasCuenta);
    expect(sumar(partes.map((p) => p.totales.icbper))).toBe(total.totales.icbper);
  }

  it('partes iguales: r, r − 1, …, 1 suman el total de la cuenta (300 cuentas)', () => {
    const rnd = semilla(0xbb67ae85);
    for (let i = 0; i < 300; i++) {
      const cuenta = generarCuenta(rnd);
      const r = entero(rnd, 1, 5);
      const partes: ParteCalculada[] = [];
      for (let k = r; k >= 1; k--) {
        const parte = parteDe(cuenta, partes, { tipo: 'IGUALES', partesRestantes: k }, 'CONSUMO');
        expect(parte.formato).toBe('CONSUMO');
        partes.push(parte);
      }
      verificarReparto(cuenta, partes);
    }
  });

  it('por ítems y TOTAL: las partes suman el total y cada línea reparte exactamente su neto (300 cuentas)', () => {
    const rnd = semilla(0x3c6ef372);
    for (let i = 0; i < 300; i++) {
      const cuenta = generarCuenta(rnd);
      const calculada = calcularCuenta(cuenta);
      const faltan = new Map(calculada.lineas.map((l) => [l.itemId, l.cantidadCobrable]));
      const partes: ParteCalculada[] = [];
      for (let ronda = 0; ronda < 4; ronda++) {
        const disponibles = cuenta.lineas.filter((l) => faltan.get(l.itemId)! > 0);
        if (disponibles.length === 0) break;
        if (ronda > 0 && rnd() < 0.4) break;
        let elegidas = disponibles.filter(() => rnd() < 0.5);
        if (elegidas.length === 0) elegidas = [disponibles[0]!];
        const items = elegidas.map((l) => ({ itemId: l.itemId, cantidad: entero(rnd, 1, faltan.get(l.itemId)!) }));
        partes.push(parteDe(cuenta, partes, { tipo: 'ITEMS', items }, formatoAlAzar(rnd)));
        for (const it of items) faltan.set(it.itemId, faltan.get(it.itemId)! - it.cantidad);
      }
      if ([...faltan.values()].some((n) => n > 0)) {
        partes.push(parteDe(cuenta, partes, { tipo: 'TOTAL' }, formatoAlAzar(rnd)));
      }
      verificarReparto(cuenta, partes);
      for (const l of calculada.lineas) {
        const tomadas = partes.flatMap((p) => p.porItem.filter((x) => x.itemId === l.itemId));
        expect(tomadas.reduce((acc, x) => acc + x.cantidad, 0)).toBe(l.cantidadCobrable);
        expect(sumar(tomadas.map((x) => x.neto))).toBe(l.neto);
      }
    }
  });

  it('primero por ítems y después en partes iguales suman el total (300 cuentas)', () => {
    const rnd = semilla(0xa54ff53a);
    for (let i = 0; i < 300; i++) {
      const cuenta = generarCuenta(rnd);
      const grande = cuenta.lineas[0]!;
      const partes: ParteCalculada[] = [
        parteDe(cuenta, [], { tipo: 'ITEMS', items: [{ itemId: grande.itemId, cantidad: 1 }] }, formatoAlAzar(rnd)),
      ];
      const r = entero(rnd, 1, 4);
      for (let k = r; k >= 1; k--) {
        partes.push(parteDe(cuenta, partes, { tipo: 'IGUALES', partesRestantes: k }, 'CONSUMO'));
      }
      verificarReparto(cuenta, partes);
    }
  });
});
