// Pruebas del desarrollador (no protegidas) · aritmética de montos de caja y precios unitarios de una línea de
// comprobante (criterio 69): sumas, restas que no esconden un saldo negativo y los ejemplos de la especificación.
import { describe, expect, it } from 'vitest';
import {
  compararMontos,
  multiplicarMonto,
  preciosUnitarios,
  restarMontos,
  sumarMontos,
} from '../../src';

describe('sumarMontos', () => {
  it('suma exacta con 2 decimales y sin coma flotante', () => {
    expect(sumarMontos(['0.10', '0.20'])).toBe('0.30');
    expect(sumarMontos([])).toBe('0.00');
    expect(sumarMontos(['69.2', '33.30', '40'])).toBe('142.50');
    expect(sumarMontos(['99999999.99', '99999999.99'])).toBe('199999999.98');
  });
  it('un monto mal formado o negativo es RangeError', () => {
    expect(() => sumarMontos(['1.234'])).toThrow(RangeError);
    expect(() => sumarMontos(['-1.00'])).toThrow(RangeError);
    expect(() => sumarMontos(['abc'])).toThrow(RangeError);
  });
});

describe('restarMontos', () => {
  it('resta exacta', () => {
    expect(restarMontos('10.00', '0.01')).toBe('9.99');
    expect(restarMontos('5.00', '5.00')).toBe('0.00');
  });
  it('un resultado negativo lanza en lugar de esconderse como 0.00', () => {
    expect(() => restarMontos('5.00', '5.01')).toThrow(RangeError);
  });
});

describe('multiplicarMonto y compararMontos', () => {
  it('multiplica por una cantidad entera', () => {
    expect(multiplicarMonto('28.00', 2)).toBe('56.00');
    expect(multiplicarMonto('0.10', 3)).toBe('0.30');
    expect(multiplicarMonto('28.00', 0)).toBe('0.00');
    expect(() => multiplicarMonto('28.00', 1.5)).toThrow(RangeError);
  });
  it('compara por valor, no por texto', () => {
    expect(compararMontos('700.00', '700')).toBe(0);
    expect(compararMontos('700.01', '700.00')).toBeGreaterThan(0);
    expect(compararMontos('99.99', '100.00')).toBeLessThan(0);
  });
});

describe('preciosUnitarios · criterio 69', () => {
  const gravado = (base: string, cantidad = 1) =>
    preciosUnitarios({ base, cantidad, afectacion: 'GRAVADO', tasaIgv: '18.00' });

  it.each([
    ['28.00', '23.7288135593'],
    ['9.00', '7.6271186441'],
    ['0.10', '0.0847457627'],
    ['25.00', '21.1864406780'],
  ])('gravado con 18.00: %s → %s', (precio, valor) => {
    expect(gravado(precio)).toEqual({ precioUnitario: precio, valorUnitario: valor });
  });

  it('el precio es el bruto entre la cantidad', () => {
    expect(gravado('56.00', 2)).toEqual({
      precioUnitario: '28.00',
      valorUnitario: '23.7288135593',
    });
  });

  it('exonerado, inafecto y sin tasa (Nuevo RUS): el precio con 10 decimales', () => {
    expect(
      preciosUnitarios({ base: '3.00', cantidad: 1, afectacion: 'EXONERADO', tasaIgv: '18.00' }),
    ).toEqual({ precioUnitario: '3.00', valorUnitario: '3.0000000000' });
    expect(
      preciosUnitarios({ base: '3.00', cantidad: 1, afectacion: 'INAFECTO', tasaIgv: '18.00' }),
    ).toEqual({ precioUnitario: '3.00', valorUnitario: '3.0000000000' });
    expect(
      preciosUnitarios({ base: '28.00', cantidad: 1, afectacion: 'GRAVADO', tasaIgv: null }),
    ).toEqual({ precioUnitario: '28.00', valorUnitario: '28.0000000000' });
  });

  it('una línea gratuita usa su valor referencial entre la cantidad', () => {
    expect(gravado('56.00', 2).precioUnitario).toBe('28.00');
    expect(gravado('0.00', 1)).toEqual({ precioUnitario: '0.00', valorUnitario: '0.0000000000' });
  });

  it('una cantidad que no es entera positiva es RangeError', () => {
    expect(() => gravado('10.00', 0)).toThrow(RangeError);
  });
});
