// spec: 006-caja-cobro (pruebas protegidas)
//
// P1 · Criterios 8 y 11 a 16 (reglas puras de montos): `calcularCuenta`, `repartirPorMayorResto` y
// `validarDescuento`. La cuenta C exacta (11), descuento por ítem (12), por cuenta y su prorrateo (13), validación
// del descuento (14), cortesías (15) y Nuevo RUS (16). En cada caso se comprueban los invariantes: Σ netos + ICBPER =
// total, base + IGV = neto por línea y Σ descuentos prorrateados = monto. Termina con una prueba de propiedad con
// semilla fija.
import { describe, expect, it } from 'vitest';
import {
  calcularCuenta,
  repartirPorMayorResto,
  validarDescuento,
  type CuentaEntrada,
  type LineaDeCuentaEntrada,
} from '../../src';
import {
  D,
  ID,
  cuentaC,
  cuentaUnaLinea,
  generarCuenta,
  lineaBolsa,
  lineaGaseosa,
  lineaLomo,
  lineaMandarina,
  semilla,
  sumar,
  verificarInvariantes,
} from './ayudas';

const porId = (cuenta: ReturnType<typeof calcularCuenta>, itemId: string) => {
  const linea = cuenta.lineas.find((l) => l.itemId === itemId);
  if (!linea) throw new Error(`Falta la línea ${itemId}`);
  return linea;
};

const sinDescuentos = { descuentoItem: '0.00', descuentoCuenta: '0.00', gratuita: null } as const;

describe('calcularCuenta · criterio 11 (cuenta C)', () => {
  it('devuelve cada línea y los totales de la cuenta C', () => {
    const entrada = cuentaC();
    const r = calcularCuenta(entrada);

    expect(r.lineas).toEqual([
      {
        itemId: ID.lomo,
        cantidadCobrable: 2,
        bruto: '56.00',
        ...sinDescuentos,
        neto: '56.00',
        base: '47.46',
        igv: '8.54',
        bolsas: 0,
        icbper: '0.00',
      },
      {
        itemId: ID.gaseosa,
        cantidadCobrable: 1,
        bruto: '9.00',
        ...sinDescuentos,
        neto: '9.00',
        base: '7.63',
        igv: '1.37',
        bolsas: 0,
        icbper: '0.00',
      },
      {
        itemId: ID.bolsa,
        cantidadCobrable: 2,
        bruto: '0.20',
        ...sinDescuentos,
        neto: '0.20',
        base: '0.17',
        igv: '0.03',
        bolsas: 2,
        icbper: '1.00',
      },
      {
        itemId: ID.mandarina,
        cantidadCobrable: 1,
        bruto: '3.00',
        ...sinDescuentos,
        neto: '3.00',
        base: '3.00',
        igv: '0.00',
        bolsas: 0,
        icbper: '0.00',
      },
    ]);
    expect(r.totales).toEqual({
      subtotal: '68.20',
      descuentos: '0.00',
      operaciones: { gravadas: '55.26', exoneradas: '3.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '9.94',
      igvGratuitas: '0.00',
      icbper: '1.00',
      total: '69.20',
    });
    verificarInvariantes(entrada, r);
  });

  it('el ICBPER es por bolsa y se suma al precio: no está incluido en él', () => {
    const r = calcularCuenta({ ...cuentaC(), montoIcbper: '0.20' });
    expect(porId(r, ID.bolsa).icbper).toBe('0.40');
    expect(porId(r, ID.bolsa).neto).toBe('0.20');
    expect(r.totales.icbper).toBe('0.40');
    expect(r.totales.total).toBe('68.60');
  });

  it('las líneas inafectas suman en inafectas y no llevan IGV', () => {
    const entrada: CuentaEntrada = {
      ...cuentaC(),
      lineas: [
        lineaLomo(),
        lineaMandarina({ itemId: ID.gaseosa, afectacion: 'INAFECTO', precioUnitario: '10.00' }),
      ],
    };
    const r = calcularCuenta(entrada);
    expect(r.totales.operaciones).toEqual({
      gravadas: '47.46',
      exoneradas: '0.00',
      inafectas: '10.00',
      gratuitas: '0.00',
    });
    expect(r.totales.igv).toBe('8.54');
    expect(r.totales.total).toBe('66.00');
    verificarInvariantes(entrada, r);
  });

  it('calcula con decimales exactos, sin coma flotante (0.10 × 3 = 0.30)', () => {
    const entrada = cuentaUnaLinea('0.10', { cantidad: 3 });
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]!.bruto).toBe('0.30');
    expect(r.totales.subtotal).toBe('0.30');
    expect(r.totales.total).toBe('0.30');
    verificarInvariantes(entrada, r);
  });

  it('soporta el mayor precio con la mayor cantidad sin perder céntimos', () => {
    const entrada = cuentaUnaLinea('99999999.99', { cantidad: 999 });
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]!.bruto).toBe('99899999990.01');
    expect(r.totales.total).toBe('99899999990.01');
    verificarInvariantes(entrada, r);
  });

  it('un precio en cero da una línea en cero', () => {
    const entrada = cuentaUnaLinea('0.00', { cantidad: 5 });
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]).toMatchObject({ bruto: '0.00', neto: '0.00', base: '0.00', igv: '0.00' });
    expect(r.totales.total).toBe('0.00');
  });

  it('conserva el orden de las líneas de la entrada', () => {
    const r = calcularCuenta({
      ...cuentaC(),
      lineas: [lineaMandarina(), lineaBolsa(), lineaGaseosa(), lineaLomo()],
    });
    expect(r.lineas.map((l) => l.itemId)).toEqual([ID.mandarina, ID.bolsa, ID.gaseosa, ID.lomo]);
  });
});

describe('calcularCuenta · criterio 12 (descuento por ítem)', () => {
  it('10 % en el Lomo', () => {
    const entrada = cuentaC({
      lineas: [
        lineaLomo({ descuento: { tipo: 'PORCENTAJE', valor: '10' } }),
        lineaGaseosa(),
        lineaBolsa(),
        lineaMandarina(),
      ],
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.lomo)).toMatchObject({
      bruto: '56.00',
      descuentoItem: '5.60',
      descuentoCuenta: '0.00',
      neto: '50.40',
      base: '42.71',
      igv: '7.69',
    });
    expect(r.totales).toMatchObject({
      subtotal: '68.20',
      descuentos: '5.60',
      operaciones: { gravadas: '50.51', exoneradas: '3.00' },
      igv: '9.09',
      icbper: '1.00',
      total: '63.60',
    });
    verificarInvariantes(entrada, r);
  });

  it('descuento en monto: se resta tal cual', () => {
    const entrada = cuentaC({
      lineas: [
        lineaLomo({ descuento: { tipo: 'MONTO', valor: '5.00' } }),
        lineaGaseosa(),
        lineaBolsa(),
        lineaMandarina(),
      ],
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.lomo)).toMatchObject({
      descuentoItem: '5.00',
      neto: '51.00',
      base: '43.22',
      igv: '7.78',
    });
    expect(r.totales.descuentos).toBe('5.00');
    expect(r.totales.total).toBe('64.20');
    verificarInvariantes(entrada, r);
  });

  it('el porcentaje se redondea a la mitad hacia arriba (5 % de 0.50 = 0.025 → 0.03)', () => {
    const entrada = cuentaUnaLinea('0.50', { descuento: { tipo: 'PORCENTAJE', valor: '5' } });
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]).toMatchObject({ descuentoItem: '0.03', neto: '0.47' });
  });

  it('el porcentaje admite decimales (12.5 % de 56.00 = 7.00)', () => {
    const entrada = cuentaUnaLinea('28.00', {
      cantidad: 2,
      descuento: { tipo: 'PORCENTAJE', valor: '12.5' },
    });
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]).toMatchObject({ bruto: '56.00', descuentoItem: '7.00', neto: '49.00' });
  });

  it('el descuento del ítem no toca el ICBPER ni a las otras líneas', () => {
    const entrada = cuentaC({
      lineas: [
        lineaLomo(),
        lineaGaseosa(),
        lineaBolsa({ descuento: { tipo: 'MONTO', valor: '0.05' } }),
        lineaMandarina(),
      ],
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.bolsa)).toMatchObject({ neto: '0.15', bolsas: 2, icbper: '1.00' });
    expect(porId(r, ID.lomo).neto).toBe('56.00');
    expect(r.totales.icbper).toBe('1.00');
    verificarInvariantes(entrada, r);
  });
});

describe('calcularCuenta · criterio 13 (descuento por cuenta y prorrateo)', () => {
  const netos = (r: ReturnType<typeof calcularCuenta>): string[] => r.lineas.map((l) => l.neto);
  const repartido = (r: ReturnType<typeof calcularCuenta>): string[] =>
    r.lineas.map((l) => l.descuentoCuenta);

  it('S/ 5.00 sobre la cuenta C se reparte por mayor resto', () => {
    const entrada = cuentaC({ descuentoCuenta: { tipo: 'MONTO', valor: '5.00' } });
    const r = calcularCuenta(entrada);
    expect(repartido(r)).toEqual(['4.11', '0.66', '0.01', '0.22']);
    expect(netos(r)).toEqual(['51.89', '8.34', '0.19', '2.78']);
    expect(porId(r, ID.lomo)).toMatchObject({ base: '43.97', igv: '7.92' });
    expect(porId(r, ID.gaseosa)).toMatchObject({ base: '7.07', igv: '1.27' });
    expect(porId(r, ID.bolsa)).toMatchObject({ base: '0.16', igv: '0.03', icbper: '1.00' });
    expect(r.totales).toMatchObject({
      descuentos: '5.00',
      operaciones: { gravadas: '51.20', exoneradas: '2.78' },
      igv: '9.22',
      icbper: '1.00',
      total: '64.20',
    });
    verificarInvariantes(entrada, r, '5.00');
  });

  it('10 % de la cuenta C es un monto de S/ 6.82', () => {
    const entrada = cuentaC({ descuentoCuenta: { tipo: 'PORCENTAJE', valor: '10' } });
    const r = calcularCuenta(entrada);
    expect(sumar(repartido(r))).toBe('6.82');
    expect(r.totales.descuentos).toBe('6.82');
    expect(repartido(r)).toEqual(['5.60', '0.90', '0.02', '0.30']);
    expect(r.totales.total).toBe('62.38');
    verificarInvariantes(entrada, r, '6.82');
  });

  it('el porcentaje de la cuenta se calcula sobre bruto menos descuento de ítem, y se redondea', () => {
    const entrada = cuentaC({
      lineas: [
        lineaLomo({ descuento: { tipo: 'PORCENTAJE', valor: '10' } }),
        lineaGaseosa(),
        lineaBolsa(),
        lineaMandarina(),
      ],
      descuentoCuenta: { tipo: 'PORCENTAJE', valor: '10' },
    });
    const r = calcularCuenta(entrada);
    // Σ(bruto − descuentoItem) = 62.60; 10 % = 6.26, repartido en exacto
    expect(repartido(r)).toEqual(['5.04', '0.90', '0.02', '0.30']);
    expect(r.totales.descuentos).toBe('11.86');
    verificarInvariantes(entrada, r, '6.26');
  });

  it('el descuento del ítem va antes que el de la cuenta: el prorrateo usa bruto − descuentoItem', () => {
    const entrada = cuentaC({
      lineas: [
        lineaLomo({ descuento: { tipo: 'PORCENTAJE', valor: '10' } }),
        lineaGaseosa(),
        lineaBolsa(),
        lineaMandarina(),
      ],
      descuentoCuenta: { tipo: 'MONTO', valor: '5.00' },
    });
    const r = calcularCuenta(entrada);
    expect(r.lineas.map((l) => l.descuentoItem)).toEqual(['5.60', '0.00', '0.00', '0.00']);
    expect(repartido(r)).toEqual(['4.02', '0.72', '0.02', '0.24']);
    expect(netos(r)).toEqual(['46.38', '8.28', '0.18', '2.76']);
    expect(r.totales.descuentos).toBe('10.60');
    verificarInvariantes(entrada, r, '5.00');
  });

  it('el ICBPER no entra en el prorrateo ni se descuenta', () => {
    const entrada = cuentaC({ descuentoCuenta: { tipo: 'MONTO', valor: '5.00' } });
    const r = calcularCuenta(entrada);
    expect(r.totales.icbper).toBe('1.00');
    expect(porId(r, ID.bolsa).icbper).toBe('1.00');
  });

  it('empate de restos: el céntimo que sobra va a la línea que va primero', () => {
    const lineas: LineaDeCuentaEntrada[] = [
      lineaLomo({ cantidad: 1, precioUnitario: '1.00' }),
      lineaGaseosa({ precioUnitario: '1.00' }),
      lineaMandarina({ afectacion: 'GRAVADO', precioUnitario: '1.00' }),
    ];
    const entrada = cuentaC({ lineas, descuentoCuenta: { tipo: 'MONTO', valor: '0.02' } });
    const r = calcularCuenta(entrada);
    expect(repartido(r)).toEqual(['0.01', '0.01', '0.00']);
    verificarInvariantes(entrada, r, '0.02');
  });

  it('una línea en cero (precio 0.00) no recibe nada y las demás absorben todo el monto', () => {
    const lineas: LineaDeCuentaEntrada[] = [
      lineaLomo({ cantidad: 1, precioUnitario: '0.00' }),
      lineaGaseosa({ precioUnitario: '10.00' }),
      lineaMandarina({ precioUnitario: '10.00' }),
    ];
    const entrada = cuentaC({ lineas, descuentoCuenta: { tipo: 'MONTO', valor: '1.01' } });
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]).toMatchObject({ bruto: '0.00', descuentoCuenta: '0.00', neto: '0.00' });
    expect(repartido(r)).toEqual(['0.00', '0.51', '0.50']);
    verificarInvariantes(entrada, r, '1.01');
  });

  it('el porcentaje de la cuenta se redondea a la mitad hacia arriba (5 % de 0.50 = 0.025 → 0.03)', () => {
    const entrada: CuentaEntrada = {
      ...cuentaUnaLinea('0.50'),
      descuentoCuenta: { tipo: 'PORCENTAJE', valor: '5' },
    };
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]).toMatchObject({ descuentoCuenta: '0.03', neto: '0.47' });
  });

  it('una sola línea recibe todo el descuento', () => {
    const entrada: CuentaEntrada = {
      ...cuentaUnaLinea('50.00'),
      descuentoCuenta: { tipo: 'MONTO', valor: '7.77' },
    };
    const r = calcularCuenta(entrada);
    expect(r.lineas[0]).toMatchObject({ descuentoCuenta: '7.77', neto: '42.23' });
  });
});

describe('repartirPorMayorResto · criterio 13', () => {
  it('la cuenta C: 5.00 entre 56.00, 9.00, 0.20 y 3.00', () => {
    expect(repartirPorMayorResto('5.00', ['56.00', '9.00', '0.20', '3.00'])).toEqual([
      '4.11',
      '0.66',
      '0.01',
      '0.22',
    ]);
  });

  it('devuelve un resultado por peso, en el mismo orden, y la suma es exactamente el monto', () => {
    const r = repartirPorMayorResto('1.00', ['1.00', '1.00', '1.00']);
    expect(r).toEqual(['0.34', '0.33', '0.33']);
    expect(sumar(r)).toBe('1.00');
  });

  it('entre restos iguales, el céntimo que falta va a la que va primero', () => {
    expect(repartirPorMayorResto('0.01', ['1.00', '1.00', '1.00'])).toEqual([
      '0.01',
      '0.00',
      '0.00',
    ]);
    expect(repartirPorMayorResto('0.02', ['1.00', '1.00', '1.00'])).toEqual([
      '0.01',
      '0.01',
      '0.00',
    ]);
  });

  it('un peso de 0.00 recibe 0.00, aunque vaya primero y haya empate', () => {
    expect(repartirPorMayorResto('10.00', ['0.00', '5.00', '5.00'])).toEqual([
      '0.00',
      '5.00',
      '5.00',
    ]);
    expect(repartirPorMayorResto('0.01', ['0.00', '2.00', '2.00'])).toEqual([
      '0.00',
      '0.01',
      '0.00',
    ]);
  });

  it('un monto de 0.00 reparte ceros', () => {
    expect(repartirPorMayorResto('0.00', ['56.00', '9.00'])).toEqual(['0.00', '0.00']);
  });

  it('un solo peso recibe todo', () => {
    expect(repartirPorMayorResto('7.77', ['3.00'])).toEqual(['7.77']);
  });

  it('rechaza montos y pesos mal formados con RangeError (criterio 8)', () => {
    expect(() => repartirPorMayorResto('abc', ['1.00'])).toThrow(RangeError);
    expect(() => repartirPorMayorResto('1.001', ['1.00'])).toThrow(RangeError);
    expect(() => repartirPorMayorResto('1.00', ['1.00', '-2.00'])).toThrow(RangeError);
    expect(() => repartirPorMayorResto('1.00', ['x'])).toThrow(RangeError);
  });
});

describe('validarDescuento · criterio 14', () => {
  it('devuelve el monto de un descuento válido', () => {
    expect(validarDescuento('56.00', { tipo: 'PORCENTAJE', valor: '10' })).toEqual({
      valido: true,
      monto: '5.60',
    });
    expect(validarDescuento('68.20', { tipo: 'PORCENTAJE', valor: '10' })).toEqual({
      valido: true,
      monto: '6.82',
    });
    expect(validarDescuento('56.00', { tipo: 'MONTO', valor: '5.00' })).toEqual({
      valido: true,
      monto: '5.00',
    });
  });

  it('los extremos válidos: 0.01 de monto, 99.99 % y todo menos un céntimo', () => {
    expect(validarDescuento('56.00', { tipo: 'MONTO', valor: '0.01' })).toEqual({
      valido: true,
      monto: '0.01',
    });
    expect(validarDescuento('56.00', { tipo: 'MONTO', valor: '55.99' })).toEqual({
      valido: true,
      monto: '55.99',
    });
    expect(validarDescuento('56.00', { tipo: 'PORCENTAJE', valor: '99.99' })).toEqual({
      valido: true,
      monto: '55.99',
    });
  });

  it('el porcentaje del monto se redondea a la mitad hacia arriba', () => {
    expect(validarDescuento('0.50', { tipo: 'PORCENTAJE', valor: '5' })).toEqual({
      valido: true,
      monto: '0.03',
    });
  });

  it('100 % es DESCUENTO_EXCESIVO', () => {
    expect(validarDescuento('56.00', { tipo: 'PORCENTAJE', valor: '100' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
  });

  it('un monto igual o mayor que la base es DESCUENTO_EXCESIVO', () => {
    expect(validarDescuento('56.00', { tipo: 'MONTO', valor: '56.00' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
    expect(validarDescuento('56.00', { tipo: 'MONTO', valor: '60.00' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
  });

  it('un porcentaje cuyo monto redondea a 0.00 es DESCUENTO_NULO (0.01 % de 9.00)', () => {
    expect(validarDescuento('9.00', { tipo: 'PORCENTAJE', valor: '0.01' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_NULO',
    });
  });

  it('"0.00" en monto o en porcentaje es DESCUENTO_NULO', () => {
    expect(validarDescuento('56.00', { tipo: 'MONTO', valor: '0.00' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_NULO',
    });
    expect(validarDescuento('56.00', { tipo: 'PORCENTAJE', valor: '0.00' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_NULO',
    });
  });

  it('un porcentaje mayor que 99.99 es DESCUENTO_EXCESIVO', () => {
    for (const valor of ['100.00', '100', '150']) {
      expect(validarDescuento('56.00', { tipo: 'PORCENTAJE', valor })).toEqual({
        valido: false,
        codigo: 'DESCUENTO_EXCESIVO',
      });
    }
  });

  it('un porcentaje válido que redondea hasta la base es DESCUENTO_EXCESIVO (99.99 % de 0.50, 50 % de 0.01)', () => {
    expect(validarDescuento('0.50', { tipo: 'PORCENTAJE', valor: '99.99' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
    expect(validarDescuento('0.01', { tipo: 'PORCENTAJE', valor: '50' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
  });

  it('49.99 % de 0.01 redondea a 0.00: DESCUENTO_NULO', () => {
    expect(validarDescuento('0.01', { tipo: 'PORCENTAJE', valor: '49.99' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_NULO',
    });
  });

  it('con base 0.00 un monto es siempre DESCUENTO_EXCESIVO', () => {
    expect(validarDescuento('0.00', { tipo: 'MONTO', valor: '0.01' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
  });

  it('rechaza entradas mal formadas con RangeError (criterio 8)', () => {
    expect(() => validarDescuento('abc', { tipo: 'MONTO', valor: '1.00' })).toThrow(RangeError);
    expect(() => validarDescuento('56.00', { tipo: 'MONTO', valor: '1.234' })).toThrow(RangeError);
    expect(() => validarDescuento('56.00', { tipo: 'PORCENTAJE', valor: 'diez' })).toThrow(
      RangeError,
    );
    expect(() => validarDescuento('-56.00', { tipo: 'MONTO', valor: '1.00' })).toThrow(RangeError);
  });
});

describe('calcularCuenta · criterio 15 (cortesías)', () => {
  it('1 Gaseosa en cortesía en la cuenta C', () => {
    const entrada = cuentaC({
      lineas: [lineaLomo(), lineaGaseosa({ cantidadCortesia: 1 }), lineaBolsa(), lineaMandarina()],
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.gaseosa)).toEqual({
      itemId: ID.gaseosa,
      cantidadCobrable: 0,
      bruto: '0.00',
      descuentoItem: '0.00',
      descuentoCuenta: '0.00',
      neto: '0.00',
      base: '0.00',
      igv: '0.00',
      bolsas: 0,
      icbper: '0.00',
      gratuita: { cantidad: 1, valorReferencial: '9.00', base: '7.63', igv: '1.37' },
    });
    expect(r.totales).toEqual({
      subtotal: '59.20',
      descuentos: '0.00',
      operaciones: { gravadas: '47.63', exoneradas: '3.00', inafectas: '0.00', gratuitas: '7.63' },
      igv: '8.57',
      igvGratuitas: '1.37',
      icbper: '1.00',
      total: '60.20',
    });
    verificarInvariantes(entrada, r);
  });

  it('una cortesía parcial cobra las demás unidades y suma el valor referencial de las regaladas', () => {
    const entrada = cuentaC({
      lineas: [lineaLomo({ cantidadCortesia: 1 }), lineaGaseosa(), lineaBolsa(), lineaMandarina()],
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.lomo)).toMatchObject({
      cantidadCobrable: 1,
      bruto: '28.00',
      neto: '28.00',
      gratuita: { cantidad: 1, valorReferencial: '28.00', base: '23.73', igv: '4.27' },
    });
    expect(r.totales).toMatchObject({
      subtotal: '40.20',
      igvGratuitas: '4.27',
      operaciones: { gratuitas: '23.73' },
      total: '41.20',
    });
    verificarInvariantes(entrada, r);
  });

  it('las líneas sin cortesía llevan gratuita null', () => {
    const r = calcularCuenta(cuentaC());
    expect(r.lineas.every((l) => l.gratuita === null)).toBe(true);
  });

  it('una línea toda en cortesía no recibe parte del descuento por cuenta', () => {
    const entrada = cuentaC({
      lineas: [lineaLomo(), lineaGaseosa({ cantidadCortesia: 1 }), lineaBolsa(), lineaMandarina()],
      descuentoCuenta: { tipo: 'MONTO', valor: '5.00' },
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.gaseosa)).toMatchObject({ descuentoCuenta: '0.00', neto: '0.00' });
    expect(r.lineas.map((l) => l.descuentoCuenta)).toEqual(['4.73', '0.00', '0.02', '0.25']);
    verificarInvariantes(entrada, r, '5.00');
  });

  it('la cortesía no entra en el subtotal, los descuentos, el IGV, el ICBPER ni el total', () => {
    const conCortesia = calcularCuenta(
      cuentaC({
        lineas: [
          lineaLomo(),
          lineaGaseosa({ cantidadCortesia: 1 }),
          lineaBolsa(),
          lineaMandarina(),
        ],
      }),
    );
    const sinGaseosa = calcularCuenta(
      cuentaC({ lineas: [lineaLomo(), lineaBolsa(), lineaMandarina()] }),
    );
    expect(conCortesia.totales.subtotal).toBe(sinGaseosa.totales.subtotal);
    expect(conCortesia.totales.igv).toBe(sinGaseosa.totales.igv);
    expect(conCortesia.totales.total).toBe(sinGaseosa.totales.total);
  });

  it('un producto con ICBPER no admite cortesía: RangeError', () => {
    expect(() =>
      calcularCuenta(
        cuentaC({ lineas: [lineaLomo(), lineaBolsa({ cantidadCortesia: 1 }), lineaMandarina()] }),
      ),
    ).toThrow(RangeError);
  });

  it('la cortesía en un emisor Nuevo RUS no lleva IGV', () => {
    const entrada = cuentaC({
      tasaIgv: null,
      lineas: [lineaLomo(), lineaGaseosa({ cantidadCortesia: 1 }), lineaBolsa(), lineaMandarina()],
    });
    const r = calcularCuenta(entrada);
    expect(porId(r, ID.gaseosa).gratuita).toEqual({
      cantidad: 1,
      valorReferencial: '9.00',
      base: '9.00',
      igv: '0.00',
    });
    expect(r.totales.igvGratuitas).toBe('0.00');
    expect(r.totales.total).toBe('60.20');
  });
});

describe('calcularCuenta · criterio 16 (Nuevo RUS)', () => {
  it('con tasaIgv null el IGV es cero en toda línea, operaciones es null y el ICBPER se suma igual', () => {
    const entrada = cuentaC({ tasaIgv: null });
    const r = calcularCuenta(entrada);
    for (const l of r.lineas) {
      expect(l.igv).toBe('0.00');
      expect(l.base).toBe(l.neto);
    }
    expect(r.totales.operaciones).toBeNull();
    expect(r.totales.igv).toBe('0.00');
    expect(r.totales.icbper).toBe('1.00');
    expect(r.totales.total).toBe('69.20');
    verificarInvariantes(entrada, r);
  });

  it('con descuento por cuenta, la base sigue siendo el neto', () => {
    const entrada = cuentaC({ tasaIgv: null, descuentoCuenta: { tipo: 'MONTO', valor: '5.00' } });
    const r = calcularCuenta(entrada);
    expect(r.lineas.map((l) => l.neto)).toEqual(['51.89', '8.34', '0.19', '2.78']);
    expect(r.lineas.map((l) => l.base)).toEqual(['51.89', '8.34', '0.19', '2.78']);
    expect(r.totales.total).toBe('64.20');
    verificarInvariantes(entrada, r, '5.00');
  });
});

describe('calcularCuenta · entradas inválidas (criterio 8)', () => {
  const unaLinea = (cambios: Record<string, unknown>): CuentaEntrada => ({
    ...cuentaC(),
    lineas: [{ ...lineaLomo(), ...cambios } as LineaDeCuentaEntrada],
  });

  it.each(['', 'abc', '-1.00', '1.234', '1,00', '123456789.00', 28, null])(
    'rechaza el precio %j con RangeError',
    (precio) => {
      expect(() => calcularCuenta(unaLinea({ precioUnitario: precio }))).toThrow(RangeError);
    },
  );

  it.each([0, 1000, 1.5, -1, '2', null, Number.NaN])(
    'rechaza la cantidad %j con RangeError',
    (cantidad) => {
      expect(() => calcularCuenta(unaLinea({ cantidad }))).toThrow(RangeError);
    },
  );

  it.each([3, -1, 0.5, '1', null])(
    'rechaza la cantidad de cortesía %j (cantidad 2) con RangeError',
    (c) => {
      expect(() => calcularCuenta(unaLinea({ cantidadCortesia: c }))).toThrow(RangeError);
    },
  );

  it.each(['0.00', '30.01', '-18.00', 'abc', '', 18])(
    'rechaza la tasa %j con RangeError',
    (tasa) => {
      expect(() => calcularCuenta(cuentaC({ tasaIgv: tasa as string }))).toThrow(RangeError);
    },
  );

  it.each(['abc', '0.501', '-0.50', '', 0.5])(
    'rechaza el monto de ICBPER %j con RangeError',
    (m) => {
      expect(() => calcularCuenta(cuentaC({ montoIcbper: m as string }))).toThrow(RangeError);
    },
  );

  it('rechaza un valor de descuento mal formado con RangeError', () => {
    expect(() =>
      calcularCuenta(unaLinea({ descuento: { tipo: 'MONTO', valor: '1.234' } })),
    ).toThrow(RangeError);
    expect(() =>
      calcularCuenta(cuentaC({ descuentoCuenta: { tipo: 'PORCENTAJE', valor: 'diez' } })),
    ).toThrow(RangeError);
  });

  it('rechaza con RangeError dos líneas con el mismo itemId', () => {
    expect(() =>
      calcularCuenta(cuentaC({ lineas: [lineaLomo(), lineaLomo({ precioUnitario: '30.00' })] })),
    ).toThrow(RangeError);
  });

  it('rechaza con RangeError la cortesía en un producto con ICBPER aunque sea de una unidad', () => {
    expect(() =>
      calcularCuenta(
        cuentaC({ lineas: [lineaLomo(), lineaBolsa({ cantidad: 3, cantidadCortesia: 1 })] }),
      ),
    ).toThrow(RangeError);
  });

  it('el rango válido de cantidad es de 1 a 999', () => {
    const uno = calcularCuenta(unaLinea({ cantidad: 1, precioUnitario: '1.00' }));
    expect(uno.lineas[0]!.bruto).toBe('1.00');
    const mil = calcularCuenta(unaLinea({ cantidad: 999, precioUnitario: '1.00' }));
    expect(mil.lineas[0]!.bruto).toBe('999.00');
  });
});

describe('calcularCuenta · invariantes sobre cuentas al azar (semilla fija)', () => {
  it('Σ netos + ICBPER = total, base + IGV = neto y Σ descuento prorrateado = monto, en 400 cuentas', () => {
    const rnd = semilla(0x6a09e667);
    for (let i = 0; i < 400; i++) {
      const entrada = generarCuenta(rnd);
      const r = calcularCuenta(entrada);

      const baseCuenta = r.lineas.reduce(
        (acc, l) => acc.plus(l.bruto).minus(l.descuentoItem),
        new D(0),
      );
      const dc = entrada.descuentoCuenta;
      const monto =
        dc === null
          ? '0.00'
          : dc.tipo === 'MONTO'
            ? new D(dc.valor).toFixed(2)
            : baseCuenta.times(dc.valor).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
      verificarInvariantes(entrada, r, monto);

      entrada.lineas.forEach((linea, j) => {
        const calc = r.lineas[j]!;
        expect(calc.cantidadCobrable).toBe(linea.cantidad - linea.cantidadCortesia);
        expect(calc.bruto).toBe(
          new D(linea.precioUnitario).times(calc.cantidadCobrable).toFixed(2),
        );
        const di = linea.descuento;
        const esperadoItem =
          di === null
            ? '0.00'
            : di.tipo === 'MONTO'
              ? new D(di.valor).toFixed(2)
              : new D(calc.bruto)
                  .times(di.valor)
                  .div(100)
                  .toDecimalPlaces(2, D.ROUND_HALF_UP)
                  .toFixed(2);
        expect(calc.descuentoItem).toBe(esperadoItem);
        if (calc.cantidadCobrable === 0) expect(calc.descuentoCuenta).toBe('0.00');
        if (entrada.tasaIgv === null) expect(calc.igv).toBe('0.00');
      });
      if (entrada.tasaIgv === null) expect(r.totales.operaciones).toBeNull();
    }
  });
});
