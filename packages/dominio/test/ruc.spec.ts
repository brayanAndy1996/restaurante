import { describe, expect, it } from 'vitest';
import { validarRuc } from '../src';

describe('validarRuc', () => {
  it.each(['20100000009', '20600000005', '10456789019'])('acepta %s', (ruc) => {
    expect(validarRuc(ruc)).toBe(true);
  });

  it.each([
    ['dígito verificador incorrecto', '20100000000'],
    ['10 dígitos', '2010000000'],
    ['prefijo no permitido', '30100000001'],
    ['con letras', '2010000000a'],
    ['vacío', ''],
    ['12 dígitos', '201000000090'],
    ['con espacios', ' 20100000009'],
  ])('rechaza %s', (_motivo, ruc) => {
    expect(validarRuc(ruc)).toBe(false);
  });

  it('rechaza valores que no son texto', () => {
    expect(validarRuc(20100000009 as unknown as string)).toBe(false);
  });
});
