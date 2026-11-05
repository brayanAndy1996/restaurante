// Historia 006 · ronda 1 del ataque, F4 · prueba del desarrollador (no protegida) del recorte de la descripción de
// una línea del comprobante (criterio 90): 250 caracteres como máximo, «…» al final, sin partir pares sustitutos.
import { describe, expect, it } from 'vitest';
import { recortarDescripcion } from '../../src/modulos/facturacion/emision.service';

describe('recortarDescripcion', () => {
  it('no toca lo que cabe en 250', () => {
    expect(recortarDescripcion('Bowl')).toBe('Bowl');
    expect(recortarDescripcion('a'.repeat(250))).toBe('a'.repeat(250));
  });

  it('recorta a 250 con «…» al final', () => {
    const r = recortarDescripcion('a'.repeat(251));
    expect(r).toBe(`${'a'.repeat(249)}…`);
    expect(r).toHaveLength(250);
  });

  it('no deja espacios antes de «…»', () => {
    const r = recortarDescripcion(`${'a'.repeat(240)}${' '.repeat(20)}zzz`);
    expect(r).toBe(`${'a'.repeat(240)}…`);
  });

  it('no parte un par sustituto', () => {
    const r = recortarDescripcion(`${'a'.repeat(248)}😀😀😀`);
    expect(r).toBe(`${'a'.repeat(248)}…`);
    expect(r).toHaveLength(249);
    expect([...r].length).toBeLessThanOrEqual(250);
  });
});
