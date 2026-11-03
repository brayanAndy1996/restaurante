import { describe, expect, it } from 'vitest';
import { COLOR_SOBRE_MARCA, colorDeMarcaAccesible, contraste } from '../../src';

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
  it('deja igual un color que ya contrasta 4.5:1 con el blanco', () => {
    expect(colorDeMarcaAccesible('#B3261E')).toEqual({ fondo: '#B3261E', texto: '#FFFFFF' });
    expect(colorDeMarcaAccesible('#1D4A9E')).toEqual({ fondo: '#1D4A9E', texto: '#FFFFFF' });
  });

  it('pasa a mayúsculas', () => {
    expect(colorDeMarcaAccesible('#b3261e').fondo).toBe('#B3261E');
  });

  it('oscurece un color claro hasta alcanzar 4.5:1', () => {
    const { fondo, texto } = colorDeMarcaAccesible('#FFD54F');
    expect(texto).toBe(COLOR_SOBRE_MARCA);
    expect(fondo).not.toBe('#FFD54F');
    expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
  });

  it('oscurece el blanco a un gris con 4.5:1', () => {
    const { fondo } = colorDeMarcaAccesible('#FFFFFF');
    expect(fondo).toMatch(/^#[0-9A-F]{6}$/);
    expect(contraste(fondo, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    // No se oscurece de más: un paso menos ya no alcanzaría.
    expect(contraste(fondo, '#FFFFFF')).toBeLessThan(4.9);
  });

  it('conserva el matiz: solo baja el brillo de todos los canales por igual', () => {
    const { fondo } = colorDeMarcaAccesible('#FF8000');
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(fondo.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g!);
    expect(g).toBeGreaterThan(b!);
    expect(contraste(fondo, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('cualquier color válido termina con 4.5:1 o más', () => {
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
      expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rechaza lo que no es #RRGGBB', () => {
    for (const malo of ['', 'B3261E', '#B3261', '#B3261EE', '#GGGGGG', 'rojo']) {
      expect(() => colorDeMarcaAccesible(malo)).toThrow(RangeError);
    }
    expect(() => colorDeMarcaAccesible(undefined as unknown as string)).toThrow(RangeError);
  });
});
