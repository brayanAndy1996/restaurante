// Pruebas del desarrollador (no protegidas) · Criterio 23: `montoEnLetras` más allá de los cuatro ejemplos de la
// especificación (apócopes, centenas, miles, millones) y los montos mal formados.
import { describe, expect, it } from 'vitest';
import { montoEnLetras } from '../../src';

describe('montoEnLetras', () => {
  it.each([
    ['0.00', 'CERO CON 00/100 SOLES'],
    ['0.01', 'CERO CON 01/100 SOLES'],
    ['0.99', 'CERO CON 99/100 SOLES'],
    ['2.00', 'DOS CON 00/100 SOLES'],
    ['10.00', 'DIEZ CON 00/100 SOLES'],
    ['15.50', 'QUINCE CON 50/100 SOLES'],
    ['16.00', 'DIECISÉIS CON 00/100 SOLES'],
    ['20.00', 'VEINTE CON 00/100 SOLES'],
    ['21.00', 'VEINTIUNO CON 00/100 SOLES'],
    ['22.00', 'VEINTIDÓS CON 00/100 SOLES'],
    ['29.90', 'VEINTINUEVE CON 90/100 SOLES'],
    ['30.00', 'TREINTA CON 00/100 SOLES'],
    ['31.00', 'TREINTA Y UNO CON 00/100 SOLES'],
    ['99.99', 'NOVENTA Y NUEVE CON 99/100 SOLES'],
    ['100.00', 'CIEN CON 00/100 SOLES'],
    ['101.00', 'CIENTO UNO CON 00/100 SOLES'],
    ['115.00', 'CIENTO QUINCE CON 00/100 SOLES'],
    ['500.00', 'QUINIENTOS CON 00/100 SOLES'],
    ['999.99', 'NOVECIENTOS NOVENTA Y NUEVE CON 99/100 SOLES'],
    ['1000.00', 'MIL CON 00/100 SOLES'],
    ['1001.00', 'MIL UNO CON 00/100 SOLES'],
    ['2000.00', 'DOS MIL CON 00/100 SOLES'],
    ['21000.00', 'VEINTIÚN MIL CON 00/100 SOLES'],
    ['31000.00', 'TREINTA Y UN MIL CON 00/100 SOLES'],
    ['101000.00', 'CIENTO UN MIL CON 00/100 SOLES'],
    ['100000.00', 'CIEN MIL CON 00/100 SOLES'],
    ['1234.56', 'MIL DOSCIENTOS TREINTA Y CUATRO CON 56/100 SOLES'],
    ['1000000.00', 'UN MILLÓN CON 00/100 SOLES'],
    ['1000001.00', 'UN MILLÓN UNO CON 00/100 SOLES'],
    ['2000000.00', 'DOS MILLONES CON 00/100 SOLES'],
    ['21000000.00', 'VEINTIÚN MILLONES CON 00/100 SOLES'],
    [
      '99999999.99',
      'NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE CON 99/100 SOLES',
    ],
    ['1000000000.00', 'MIL MILLONES CON 00/100 SOLES'],
  ])('%s → %s', (monto, letras) => {
    expect(montoEnLetras(monto)).toBe(letras);
  });

  it('acepta montos sin decimales o con uno', () => {
    expect(montoEnLetras('69')).toBe('SESENTA Y NUEVE CON 00/100 SOLES');
    expect(montoEnLetras('69.2')).toBe('SESENTA Y NUEVE CON 20/100 SOLES');
  });

  it.each(['', '-1.00', '1,00', '1.234', '1e3', ' 1.00', '.50', 69, null, undefined])(
    'rechaza %j con RangeError',
    (monto) => {
      expect(() => montoEnLetras(monto as string)).toThrow(RangeError);
    },
  );
});
