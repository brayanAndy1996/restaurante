import { describe, expect, it } from 'vitest';
import {
  COLOR_SOBRE_MARCA,
  COLOR_SOBRE_MARCA_CLARA,
  colorDeMarcaAccesible,
  colorDeMarcaSobreBlanco,
  contraste,
} from '../../src';

// Color de la marca de la carta web (historia 005, criterio 89): pruebas del desarrollador, no críticas.

describe('contraste', () => {
  it('blanco sobre negro es 21 y un color contra sí mismo es 1', () => {
    expect(contraste('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contraste('#B3261E', '#B3261E')).toBeCloseTo(1, 5);
  });

  it('no depende del orden', () => {
    expect(contraste('#B3261E', '#FFFFFF')).toBeCloseTo(contraste('#FFFFFF', '#B3261E'), 10);
  });
});

describe('colorDeMarcaAccesible (criterio 89)', () => {
  it('deja igual un color que contrasta 4.5:1 con el blanco y le pone texto blanco', () => {
    expect(colorDeMarcaAccesible('#B3261E')).toEqual({ fondo: '#B3261E', texto: '#FFFFFF' });
    expect(colorDeMarcaAccesible('#1D4A9E')).toEqual({ fondo: '#1D4A9E', texto: '#FFFFFF' });
  });

  it('un rojo oscuro lleva texto blanco', () => {
    expect(colorDeMarcaAccesible('#8B1A1A')).toEqual({ fondo: '#8B1A1A', texto: '#FFFFFF' });
  });

  it('pasa a mayúsculas', () => {
    expect(colorDeMarcaAccesible('#b3261e').fondo).toBe('#B3261E');
  });

  it('un color claro no se oscurece: queda tal cual con texto casi negro', () => {
    expect(contraste('#F2A900', '#FFFFFF')).toBeLessThan(4.5);
    expect(colorDeMarcaAccesible('#F2A900')).toEqual({ fondo: '#F2A900', texto: '#111111' });
    expect(colorDeMarcaAccesible('#f2a900').fondo).toBe('#F2A900');
    const { fondo, texto } = colorDeMarcaAccesible('#FFD54F');
    expect(fondo).toBe('#FFD54F');
    expect(texto).toBe(COLOR_SOBRE_MARCA_CLARA);
    expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
  });

  it('el blanco queda blanco con texto casi negro', () => {
    expect(colorDeMarcaAccesible('#FFFFFF')).toEqual({ fondo: '#FFFFFF', texto: '#111111' });
  });

  it('elige el blanco primero: si alcanza 4.5:1 no pasa al casi negro', () => {
    const { texto } = colorDeMarcaAccesible('#767676');
    expect(contraste('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(texto).toBe(COLOR_SOBRE_MARCA);
  });

  it('un gris medio, que no alcanza ni con blanco ni con casi negro, lleva negro puro', () => {
    const hex = '#797979';
    expect(contraste(hex, '#FFFFFF')).toBeLessThan(4.5);
    expect(contraste(hex, '#111111')).toBeLessThan(4.5);
    expect(colorDeMarcaAccesible(hex)).toEqual({ fondo: hex, texto: '#000000' });
    expect(contraste(hex, '#000000')).toBeGreaterThanOrEqual(4.5);
  });

  it('nunca cambia el fondo y cualquier color termina con 4.5:1 o más', () => {
    for (const hex of [
      '#000000',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#808080',
      '#7F7F7F',
    ]) {
      const { fondo, texto } = colorDeMarcaAccesible(hex);
      expect(fondo).toBe(hex);
      expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('en una malla de colores el texto siempre alcanza 4.5:1 y el negro puro es el último recurso', () => {
    const pasos = [0, 51, 102, 153, 204, 255];
    const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    for (const r of pasos) {
      for (const g of pasos) {
        for (const b of pasos) {
          const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
          const { fondo, texto } = colorDeMarcaAccesible(hex);
          expect(fondo).toBe(hex);
          expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
          if (texto === '#000000') {
            expect(contraste(hex, '#FFFFFF')).toBeLessThan(4.5);
            expect(contraste(hex, '#111111')).toBeLessThan(4.5);
          }
        }
      }
    }
  });

  it('rechaza lo que no es #RRGGBB', () => {
    for (const malo of ['', 'B3261E', '#B3261', '#B3261EE', '#GGGGGG', 'rojo']) {
      expect(() => colorDeMarcaAccesible(malo)).toThrow(RangeError);
    }
    expect(() => colorDeMarcaAccesible(undefined as unknown as string)).toThrow(RangeError);
  });
});

describe('colorDeMarcaSobreBlanco (indicadores sobre fondo blanco)', () => {
  it('devuelve la marca, en mayúsculas, si contrasta 3:1 o más con el blanco', () => {
    expect(colorDeMarcaSobreBlanco('#cb4d29')).toBe('#CB4D29');
    expect(contraste('#CB4D29', '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(colorDeMarcaSobreBlanco('#1D4A9E')).toBe('#1D4A9E');
  });

  it('también la devuelve cuando contrasta entre 3:1 y 4.5:1 (la marca tiene texto casi negro encima)', () => {
    const hex = '#E4572E';
    const c = contraste(hex, '#FFFFFF');
    expect(c).toBeGreaterThanOrEqual(3);
    expect(c).toBeLessThan(4.5);
    expect(colorDeMarcaSobreBlanco(hex)).toBe(hex);
  });

  it('si la marca no contrasta 3:1 con el blanco, devuelve el texto calculado', () => {
    expect(contraste('#F2A900', '#FFFFFF')).toBeLessThan(3);
    expect(colorDeMarcaSobreBlanco('#F2A900')).toBe('#111111');
    expect(colorDeMarcaSobreBlanco('#FFFFFF')).toBe('#111111');
  });

  it('siempre devuelve algo que contrasta 3:1 o más con el blanco', () => {
    for (const hex of [
      '#000000',
      '#FF0000',
      '#00FF00',
      '#0000FF',
      '#FFFF00',
      '#808080',
      '#F2A900',
    ]) {
      expect(contraste(colorDeMarcaSobreBlanco(hex), '#FFFFFF')).toBeGreaterThanOrEqual(3);
    }
  });

  it('rechaza lo que no es #RRGGBB', () => {
    expect(() => colorDeMarcaSobreBlanco('rojo')).toThrow(RangeError);
  });
});
