import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EntornoInvalidoError,
  ORIGENES_PERMITIDOS_LOCAL,
  PIN_PEPPER_LOCAL,
  cargarEntorno,
} from '../src/config/entorno';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://restaurante_api:x@localhost:5432/restaurante_test',
  DATABASE_PLATAFORMA_URL: 'postgres://restaurante_plataforma:x@localhost:5432/restaurante_test',
};

describe('cargarEntorno', () => {
  it('aplica valores por defecto (menos NODE_ENV, que es obligatoria: criterio 29b)', () => {
    const entorno = cargarEntorno(base);
    expect(entorno).toMatchObject({ NODE_ENV: 'development', PORT: 3000, DB_POOL_MAX: 10 });
    expect(entorno.EMPRESA_POR_HEADER).toBeUndefined();
  });

  it('convierte PORT y DB_POOL_MAX a número', () => {
    expect(cargarEntorno({ ...base, PORT: '4000', DB_POOL_MAX: '2' })).toMatchObject({
      PORT: 4000,
      DB_POOL_MAX: 2,
    });
  });

  it('rechaza EMPRESA_POR_HEADER=habilitado en producción, aunque falte otra variable', () => {
    for (const env of [{ ...base }, {}]) {
      const intento = () =>
        cargarEntorno({ ...env, NODE_ENV: 'production', EMPRESA_POR_HEADER: 'habilitado' });
      expect(intento).toThrow(EntornoInvalidoError);
      expect(intento).toThrow(/EMPRESA_POR_HEADER=habilitado está prohibido en producción/);
    }
  });

  it('acepta EMPRESA_POR_HEADER=habilitado en development y test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(cargarEntorno({ ...base, NODE_ENV, EMPRESA_POR_HEADER: 'habilitado' })).toMatchObject({
        EMPRESA_POR_HEADER: 'habilitado',
      });
    }
  });

  it('acepta producción sin EMPRESA_POR_HEADER', () => {
    expect(cargarEntorno({ ...base, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('trata una variable vacía como ausente', () => {
    expect(
      cargarEntorno({ ...base, NODE_ENV: 'production', EMPRESA_POR_HEADER: '' }).NODE_ENV,
    ).toBe('production');
  });

  it('lista las variables que faltan o son inválidas', () => {
    expect(() => cargarEntorno({})).toThrow(/DATABASE_URL/);
    expect(() => cargarEntorno({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => cargarEntorno({ ...base, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
  });
});

describe('PIN_PEPPER y ORIGENES_PERMITIDOS (historia 002)', () => {
  const pepper = Buffer.alloc(32, 7).toString('base64');

  it('con development y test tienen valor por defecto', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const entorno = cargarEntorno({ ...base, NODE_ENV });
      expect(entorno.PIN_PEPPER, NODE_ENV).toBe(PIN_PEPPER_LOCAL);
      expect(entorno.ORIGENES_PERMITIDOS, NODE_ENV).toEqual([ORIGENES_PERMITIDOS_LOCAL]);
    }
    expect(Buffer.from(PIN_PEPPER_LOCAL, 'base64').length).toBeGreaterThanOrEqual(32);
  });

  it('el valor por defecto de PIN_PEPPER no se aplica en producción (será obligatoria desde T10)', () => {
    const entorno = cargarEntorno({ ...base, NODE_ENV: 'production' });
    expect(entorno.PIN_PEPPER).toBeUndefined();
    expect(entorno.ORIGENES_PERMITIDOS).toEqual([]);
  });

  it('acepta los valores explícitos, también en producción', () => {
    const entorno = cargarEntorno({
      ...base,
      NODE_ENV: 'production',
      PIN_PEPPER: pepper,
      ORIGENES_PERMITIDOS: 'https://app.ejemplo.pe, http://localhost:5173',
    });
    expect(entorno.PIN_PEPPER).toBe(pepper);
    expect(entorno.ORIGENES_PERMITIDOS).toEqual([
      'https://app.ejemplo.pe',
      'http://localhost:5173',
    ]);
  });

  it('una variable vacía es como una ausente', () => {
    const entorno = cargarEntorno({ ...base, PIN_PEPPER: '', ORIGENES_PERMITIDOS: '' });
    expect(entorno.PIN_PEPPER).toBe(PIN_PEPPER_LOCAL);
    expect(entorno.ORIGENES_PERMITIDOS).toEqual([ORIGENES_PERMITIDOS_LOCAL]);
  });

  it('rechaza un PIN_PEPPER corto o que no es base64', () => {
    for (const malo of [
      Buffer.alloc(31, 1).toString('base64'),
      'corto',
      'no es base64 !!',
      '***',
    ]) {
      expect(() => cargarEntorno({ ...base, PIN_PEPPER: malo }), malo).toThrow(/PIN_PEPPER/);
    }
    expect(() => cargarEntorno({ ...base, PIN_PEPPER: pepper })).not.toThrow();
  });

  it('rechaza orígenes con ruta, barra final, otro protocolo o que no son URL', () => {
    for (const malo of [
      'https://app.ejemplo.pe/',
      'https://app.ejemplo.pe/ruta',
      'ftp://app.ejemplo.pe',
      'app.ejemplo.pe',
      'http://localhost:5173,*',
    ]) {
      expect(() => cargarEntorno({ ...base, ORIGENES_PERMITIDOS: malo }), malo).toThrow(
        /ORIGENES_PERMITIDOS/,
      );
    }
  });

  it('no cambia la regla de EMPRESA_POR_HEADER (se cambia en la fase C)', () => {
    expect(
      cargarEntorno({ ...base, NODE_ENV: 'development', EMPRESA_POR_HEADER: 'habilitado' })
        .EMPRESA_POR_HEADER,
    ).toBe('habilitado');
  });
});

describe('cargarEntorno lee process.env en cada llamada', () => {
  const original = { ...process.env };
  beforeEach(() => Object.assign(process.env, base));
  afterEach(() => {
    process.env = { ...original };
  });

  it('refleja los cambios de process.env entre llamadas', () => {
    process.env.NODE_ENV = 'test';
    expect(cargarEntorno().NODE_ENV).toBe('test');
    process.env.NODE_ENV = 'production';
    expect(cargarEntorno().NODE_ENV).toBe('production');
  });
});
