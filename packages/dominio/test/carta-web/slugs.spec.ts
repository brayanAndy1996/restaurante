import { describe, expect, it } from 'vitest';
import { SLUGS_RESERVADOS, esSlugValido, propuestaDeSlug } from '../../src';

// Direcciones de la carta web (historia 005, criterio 2): pruebas del desarrollador, no críticas.

describe('SLUGS_RESERVADOS', () => {
  it('son exactamente los doce del criterio 2', () => {
    expect([...SLUGS_RESERVADOS]).toEqual([
      'api',
      'app',
      'www',
      'publico',
      'carta',
      'cartas',
      'admin',
      'ayuda',
      'static',
      'robots',
      'sitemap',
      'favicon',
    ]);
  });
});

describe('esSlugValido (criterio 2)', () => {
  it.each(['sabor-norteno', 'miraflores', 'abc', 'a1b', 'sede-2-centro', 'x'.repeat(40)])(
    'acepta %s',
    (slug) => {
      expect(esSlugValido(slug)).toBe(true);
    },
  );

  it.each([
    ['dos caracteres', 'ab'],
    ['41 caracteres', 'x'.repeat(41)],
    ['vacío', ''],
    ['mayúsculas', 'Sabor-norteno'],
    ['guion al inicio', '-sabor'],
    ['guion al final', 'sabor-'],
    ['guiones seguidos', 'sabor--norteno'],
    ['espacio', 'sabor norteno'],
    ['guion bajo', 'sabor_norteno'],
    ['tilde', 'norteño'],
    ['barra', 'a/b'],
    ['punto', 'a.b'],
  ])('rechaza %s', (_motivo, slug) => {
    expect(esSlugValido(slug)).toBe(false);
  });

  it.each(SLUGS_RESERVADOS.filter((s) => s.length >= 3))('rechaza la reservada %s', (slug) => {
    expect(esSlugValido(slug)).toBe(false);
  });

  it('una reservada con otra letra o con sufijo sí vale', () => {
    expect(esSlugValido('apis')).toBe(true);
    expect(esSlugValido('carta-sur')).toBe(true);
  });

  it('un valor que no es texto no es válido', () => {
    expect(esSlugValido(undefined as unknown as string)).toBe(false);
    expect(esSlugValido(null as unknown as string)).toBe(false);
  });
});

describe('propuestaDeSlug (criterio 74)', () => {
  it('quita tildes y eñes, pasa a minúsculas y une con guiones', () => {
    expect(propuestaDeSlug('Sabor Norteño')).toBe('sabor-norteno');
    expect(propuestaDeSlug('  Café   Ñandú & Hijos  ')).toBe('cafe-nandu-hijos');
  });

  it('descarta la puntuación de los extremos', () => {
    expect(propuestaDeSlug('¡Los Olivos!')).toBe('los-olivos');
  });

  it('corta a 40 caracteres sin dejar un guion al final', () => {
    const propuesta = propuestaDeSlug('Restaurante campestre de la sierra central del Perú S.A.C.');
    expect(propuesta.length).toBeLessThanOrEqual(40);
    expect(propuesta.endsWith('-')).toBe(false);
    expect(esSlugValido(propuesta)).toBe(true);
  });

  it('devuelve vacío si el nombre no da una dirección válida', () => {
    expect(propuestaDeSlug('')).toBe('');
    expect(propuestaDeSlug('!!')).toBe('');
    expect(propuestaDeSlug('漢字')).toBe('');
    expect(propuestaDeSlug('Carta')).toBe('');
    expect(propuestaDeSlug('ab')).toBe('');
  });

  it('siempre devuelve una dirección válida o vacío', () => {
    for (const nombre of ['El Rincón', 'Pollería "Don José"', 'A1', '100% Criollo', 'Menú 2x1']) {
      const propuesta = propuestaDeSlug(nombre);
      expect(propuesta === '' || esSlugValido(propuesta)).toBe(true);
    }
  });
});
