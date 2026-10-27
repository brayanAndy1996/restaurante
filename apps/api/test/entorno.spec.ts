import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EntornoInvalidoError, cargarEntorno } from '../src/config/entorno';

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
