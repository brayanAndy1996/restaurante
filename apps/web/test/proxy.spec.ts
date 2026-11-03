import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import config, { CACHE_CONTROL_CARTA } from '../next.config';
import { proxy } from '../proxy';
import { rutaEnMinusculas } from '../lib/rutas';

// Direcciones en minúsculas con 308 (criterio 79) y cabeceras de la carta (criterio 80).

describe('rutaEnMinusculas', () => {
  it('pasa a minúsculas la empresa y la sucursal', () => {
    expect(rutaEnMinusculas('/Sabor-Norteno')).toBe('/sabor-norteno');
    expect(rutaEnMinusculas('/Sabor-Norteno/MIRAFLORES')).toBe('/sabor-norteno/miraflores');
  });

  it('no toca lo que ya está en minúsculas ni lo que va después de la sucursal', () => {
    expect(rutaEnMinusculas('/sabor-norteno/miraflores')).toBe('/sabor-norteno/miraflores');
    expect(rutaEnMinusculas('/A-B-C/D-E-F/opengraph-image')).toBe('/a-b-c/d-e-f/opengraph-image');
  });

  it('el código de una mesa distingue mayúsculas y nunca se toca', () => {
    expect(rutaEnMinusculas('/m/Mesa4AbCdEfGhIjKlMnOpQ')).toBe('/m/Mesa4AbCdEfGhIjKlMnOpQ');
    expect(rutaEnMinusculas('/M/Mesa4AbCdEfGhIjKlMnOpQ')).toBe('/m/Mesa4AbCdEfGhIjKlMnOpQ');
  });

  it('la raíz queda igual', () => {
    expect(rutaEnMinusculas('/')).toBe('/');
  });
});

describe('proxy', () => {
  const pedir = (ruta: string) => proxy(new NextRequest(`http://localhost:3001${ruta}`));

  it('una dirección con mayúsculas redirige con 308 a minúsculas y conserva la consulta', () => {
    const respuesta = pedir('/Sabor-Norteno/Miraflores?mesa=4');
    expect(respuesta.status).toBe(308);
    expect(respuesta.headers.get('location')).toBe(
      'http://localhost:3001/sabor-norteno/miraflores?mesa=4',
    );
  });

  it('una dirección en minúsculas sigue su camino', () => {
    const respuesta = pedir('/sabor-norteno/miraflores');
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('location')).toBeNull();
  });

  it('el código de mesa con mayúsculas no redirige', () => {
    expect(pedir('/m/Mesa4AbCdEfGhIjKlMnOpQ').headers.get('location')).toBeNull();
  });
});

describe('cabeceras de la carta (criterio 80)', () => {
  it('la carta se guarda 30 s y se sirve 60 s más mientras se renueva', async () => {
    expect(CACHE_CONTROL_CARTA).toBe('public, s-maxage=30, stale-while-revalidate=60');
    const reglas = (await config.headers?.()) ?? [];
    const deCarta = reglas.filter((regla) => !regla.source.startsWith('/m/'));
    // Solo `/<empresa>/<sucursal>`: la lista de sucursales de `/<empresa>` no se guarda.
    expect(deCarta).toHaveLength(1);
    expect(deCarta[0]?.source).toMatch(/:sucursal/);
    expect(deCarta[0]?.headers).toEqual([{ key: 'Cache-Control', value: CACHE_CONTROL_CARTA }]);
  });
});
