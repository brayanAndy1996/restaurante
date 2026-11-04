// spec: 006-caja-cobro (pruebas protegidas)
//
// P1 · Criterios 23 y 51 (reglas puras): `montoEnLetras` con los cuatro ejemplos del criterio 23 y
// `tiposDeComprobantePermitidos` según el régimen del emisor (criterio 51, RF-65).
import { describe, expect, it } from 'vitest';
import { REGIMENES_TRIBUTARIOS, montoEnLetras, tiposDeComprobantePermitidos } from '../../src';

describe('montoEnLetras · criterio 23', () => {
  it.each([
    ['69.20', 'SESENTA Y NUEVE CON 20/100 SOLES'],
    ['1.00', 'UNO CON 00/100 SOLES'],
    ['0.50', 'CERO CON 50/100 SOLES'],
    ['1000000.00', 'UN MILLÓN CON 00/100 SOLES'],
  ])('%s → %s', (monto, letras) => {
    expect(montoEnLetras(monto)).toBe(letras);
  });

  it('rechaza un monto mal formado con RangeError (criterio 8)', () => {
    expect(() => montoEnLetras('abc')).toThrow(RangeError);
    expect(() => montoEnLetras('1.234')).toThrow(RangeError);
  });
});

describe('tiposDeComprobantePermitidos · criterio 51', () => {
  it('el Nuevo RUS solo emite boletas (RF-65)', () => {
    expect([...tiposDeComprobantePermitidos('NUEVO_RUS')]).toEqual(['BOLETA']);
  });

  it.each(['GENERAL', 'RER', 'MYPE_TRIBUTARIO'] as const)('%s emite boletas y facturas', (regimen) => {
    expect([...tiposDeComprobantePermitidos(regimen)].sort()).toEqual(['BOLETA', 'FACTURA']);
  });

  it('cubre todos los regímenes del catálogo y nadie queda sin boleta', () => {
    for (const regimen of REGIMENES_TRIBUTARIOS) {
      expect(tiposDeComprobantePermitidos(regimen)).toContain('BOLETA');
    }
  });
});
