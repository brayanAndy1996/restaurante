import { describe, expect, it } from 'vitest';
import { precioEnSoles, precioEsCero, precioLeido } from '../../src';

// Forma y lectura de los precios de la carta web (historia 005, criterios 81 y 90): pruebas del desarrollador.

describe('precioEnSoles', () => {
  it('muestra siempre 2 decimales y un espacio duro', () => {
    expect(precioEnSoles('28.00')).toBe('S/\u00a028.00');
    expect(precioEnSoles('28')).toBe('S/\u00a028.00');
    expect(precioEnSoles('28.5')).toBe('S/\u00a028.50');
    expect(precioEnSoles('0.00')).toBe('S/\u00a00.00');
  });

  it('no pone separador de miles', () => {
    expect(precioEnSoles('1234.50')).toBe('S/\u00a01234.50');
  });

  it('rechaza lo que no es un precio', () => {
    for (const malo of ['', '-1', '1,5', 'abc', '1.234', '1e3', ' 5']) {
      expect(() => precioEnSoles(malo)).toThrow(RangeError);
    }
    expect(() => precioEnSoles(undefined as unknown as string)).toThrow(RangeError);
  });
});

describe('precioLeido', () => {
  it('lee los soles enteros', () => {
    expect(precioLeido('28.00')).toBe('28 soles');
    expect(precioLeido('1.00')).toBe('1 sol');
    expect(precioLeido('0')).toBe('0 soles');
  });

  it('agrega los céntimos si los hay', () => {
    expect(precioLeido('28.50')).toBe('28 soles con 50 céntimos');
    expect(precioLeido('12.05')).toBe('12 soles con 5 céntimos');
    expect(precioLeido('12.01')).toBe('12 soles con 1 céntimo');
    expect(precioLeido('0.50')).toBe('0 soles con 50 céntimos');
  });

  it('es exacto con decimales que en coma flotante fallan', () => {
    expect(precioLeido('0.29')).toBe('0 soles con 29 céntimos');
    expect(precioLeido('1.15')).toBe('1 sol con 15 céntimos');
  });

  it('rechaza lo que no es un precio', () => {
    expect(() => precioLeido('mucho')).toThrow(RangeError);
  });
});

describe('precioEsCero', () => {
  it('distingue el cero de cualquier otro precio', () => {
    expect(precioEsCero('0')).toBe(true);
    expect(precioEsCero('0.00')).toBe(true);
    expect(precioEsCero('0.01')).toBe(false);
    expect(precioEsCero('3.00')).toBe(false);
  });

  it('rechaza lo que no es un precio', () => {
    expect(() => precioEsCero('gratis')).toThrow(RangeError);
  });
});
