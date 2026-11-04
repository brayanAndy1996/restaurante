// spec: 006-caja-cobro (pruebas protegidas)
//
// P1 · Criterios 8 y 9 (reglas puras de montos): `desglosar`. Un caso por cada ejemplo del criterio 9, las
// entradas mal formadas que el criterio 8 manda rechazar con `RangeError`, la exactitud decimal y el redondeo
// de mitad hacia arriba.
import { describe, expect, it } from 'vitest';
import { desglosar } from '../../src';
import { D, dosDec } from './ayudas';

describe('desglosar · ejemplos del criterio 9 (IGV de 18.00)', () => {
  it.each([
    ['56.00', { base: '47.46', igv: '8.54' }],
    ['9.00', { base: '7.63', igv: '1.37' }],
    ['0.20', { base: '0.17', igv: '0.03' }],
    ['0.01', { base: '0.01', igv: '0.00' }],
    ['0.00', { base: '0.00', igv: '0.00' }],
  ])('GRAVADO %s', (neto, esperado) => {
    expect(desglosar(neto, 'GRAVADO', '18.00')).toEqual(esperado);
  });

  it('EXONERADO: la base es el neto y el IGV es cero', () => {
    expect(desglosar('3.00', 'EXONERADO', '18.00')).toEqual({ base: '3.00', igv: '0.00' });
  });

  it('INAFECTO: la base es el neto y el IGV es cero', () => {
    expect(desglosar('10.00', 'INAFECTO', '18.00')).toEqual({ base: '10.00', igv: '0.00' });
  });

  it('acepta montos sin decimales o con uno y devuelve siempre 2 decimales', () => {
    expect(desglosar('56', 'GRAVADO', '18.00')).toEqual({ base: '47.46', igv: '8.54' });
    expect(desglosar('3.5', 'EXONERADO', '18.00')).toEqual({ base: '3.50', igv: '0.00' });
  });
});

describe('desglosar · Nuevo RUS (tasaIgv null)', () => {
  it.each(['GRAVADO', 'EXONERADO', 'INAFECTO'] as const)(
    'en toda afectación (%s) la base es el neto y el IGV es cero',
    (afectacion) => {
      expect(desglosar('56.00', afectacion, null)).toEqual({ base: '56.00', igv: '0.00' });
      expect(desglosar('0.00', afectacion, null)).toEqual({ base: '0.00', igv: '0.00' });
    },
  );
});

describe('desglosar · otras tasas y redondeo', () => {
  it('usa la tasa recibida y no un 18 fijo', () => {
    expect(desglosar('110.00', 'GRAVADO', '10.00')).toEqual({ base: '100.00', igv: '10.00' });
    expect(desglosar('1.00', 'GRAVADO', '30.00')).toEqual({ base: '0.77', igv: '0.23' });
  });

  it('acepta los extremos de la tasa, "0.01" y "30.00"', () => {
    expect(desglosar('100.00', 'GRAVADO', '0.01')).toEqual({ base: '99.99', igv: '0.01' });
    expect(desglosar('130.00', 'GRAVADO', '30.00')).toEqual({ base: '100.00', igv: '30.00' });
  });

  it('redondea la base a la mitad hacia arriba (ROUND_HALF_UP)', () => {
    // 0.03 / 1.20 = 0.025 exacto; 0.09 / 1.20 = 0.075 exacto
    expect(desglosar('0.03', 'GRAVADO', '20.00')).toEqual({ base: '0.03', igv: '0.00' });
    expect(desglosar('0.09', 'GRAVADO', '20.00')).toEqual({ base: '0.08', igv: '0.01' });
  });

  it('no usa coma flotante: montos grandes salen exactos', () => {
    expect(desglosar('99999999.99', 'EXONERADO', '18.00')).toEqual({
      base: '99999999.99',
      igv: '0.00',
    });
    const r = desglosar('99999999.99', 'GRAVADO', '18.00');
    expect(dosDec(new D(r.base).plus(r.igv))).toBe('99999999.99');
  });

  it('base + IGV = neto para todo neto de 0.00 a 50.00 (de a un céntimo) y cada tasa', () => {
    for (const tasa of ['18.00', '10.00', '7.50', '30.00', '0.01']) {
      for (let c = 0; c <= 5000; c++) {
        const neto = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
        const { base, igv } = desglosar(neto, 'GRAVADO', tasa);
        expect(dosDec(new D(base).plus(igv))).toBe(neto);
        expect(new D(igv).gte(0)).toBe(true);
        expect(new D(base).lte(neto)).toBe(true);
      }
    }
  });
});

describe('desglosar · entradas inválidas (criterio 8)', () => {
  const malos: unknown[] = [
    '',
    'abc',
    '-1.00',
    '1.234',
    '1,00',
    ' 1.00',
    '1e3',
    '.50',
    '1.',
    '123456789.00',
    56,
    null,
    undefined,
  ];

  it.each(malos)('rechaza el monto %j con RangeError', (neto) => {
    expect(() => desglosar(neto as string, 'GRAVADO', '18.00')).toThrow(RangeError);
  });

  it.each(['0.00', '0', '30.01', '31.00', '-1.00', 'abc', '', 18, undefined])(
    'rechaza la tasa %j con RangeError',
    (tasa) => {
      expect(() => desglosar('56.00', 'GRAVADO', tasa as string | null)).toThrow(RangeError);
    },
  );
});
