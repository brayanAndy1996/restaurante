// Historia 003, criterio 49: el `ETag` de la vista. Pruebas del desarrollador (no protegidas) de las funciones
// puras: el JSON canónico (sin depender del orden de las claves) y la comparación con `If-None-Match`.
import { describe, expect, it } from 'vitest';
import { coincideConEtag, etagDeVista, jsonCanonico } from '../../src/modulos/carta/etag-carta';

describe('jsonCanonico', () => {
  it('ordena las claves de cada objeto, también las anidadas, y respeta el orden de las listas', () => {
    expect(jsonCanonico({ b: 1, a: { d: [3, 2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,2,1]},"b":1}',
    );
  });

  it('ignora las claves undefined y escribe los textos con sus escapes', () => {
    expect(jsonCanonico({ a: undefined, b: 'ñ"\n' })).toBe('{"b":"ñ\\"\\n"}');
  });

  it('distingue null, cero, falso y el texto vacío', () => {
    const textos = [null, 0, false, ''].map((x) => jsonCanonico({ x }));
    expect(new Set(textos).size).toBe(4);
  });
});

describe('etagDeVista', () => {
  it('es el mismo con las claves en otro orden y cambia con cualquier valor', () => {
    const a = etagDeVista({ x: 1, y: [{ p: '1.00', q: 'a' }] });
    expect(etagDeVista({ y: [{ q: 'a', p: '1.00' }], x: 1 })).toBe(a);
    expect(etagDeVista({ x: 1, y: [{ p: '1.01', q: 'a' }] })).not.toBe(a);
    expect(
      etagDeVista({
        x: 1,
        y: [
          { p: '1.00', q: 'a' },
          { p: '1.00', q: 'a' },
        ],
      }),
    ).not.toBe(a);
  });

  it('es un ETag fuerte: SHA-256 en base64url entre comillas', () => {
    expect(etagDeVista({})).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
  });
});

describe('coincideConEtag', () => {
  const etag = etagDeVista({ a: 1 });

  it('coincide con el mismo valor, con la forma débil, dentro de una lista y con *', () => {
    expect(coincideConEtag(etag, etag)).toBe(true);
    expect(coincideConEtag(`W/${etag}`, etag)).toBe(true);
    expect(coincideConEtag(`"otro" ,  ${etag}`, etag)).toBe(true);
    expect(coincideConEtag(' * ', etag)).toBe(true);
  });

  it('no coincide sin cabecera, vacía, con otro valor o sin comillas', () => {
    expect(coincideConEtag(undefined, etag)).toBe(false);
    expect(coincideConEtag('', etag)).toBe(false);
    expect(coincideConEtag('"otro"', etag)).toBe(false);
    expect(coincideConEtag(etag.slice(1, -1), etag)).toBe(false);
  });
});
