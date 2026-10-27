// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 29b (falla de la ronda 3): `NODE_ENV` es obligatorio. Sin `NODE_ENV` (o vacío) la API no
// arranca y el mensaje dice que falta `NODE_ENV` y cuáles son sus valores válidos (`development`,
// `test`, `production`); con cualquier otro valor tampoco. Así un despliegue que olvide
// `NODE_ENV=production` no queda con el resolutor por cabecera. Además, lo que deriva contraseñas de
// los roles (`db:preparar`, `contrasenasDeRoles`, `urlParaRol`) solo usa las contraseñas por defecto
// con `NODE_ENV` `development` o `test` explícito: sin `NODE_ENV` o con `production`, si falta alguna
// `DB_PASSWORD_*` falla nombrando la variable y sin crear ni modificar roles.
import type { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { cargarEntorno } from '../../src/config/entorno';
import { prepararBaseDeDatos } from '../../scripts/lib/preparar-bd';
import { contrasenasDeRoles, urlParaRol } from '../../scripts/lib/roles';
import { fijarEntornoDePrueba } from '../utilidades';

const COPIA = { ...process.env };

beforeEach(() => {
  fijarEntornoDePrueba();
});

afterEach(() => {
  // Restaura el entorno exacto del proceso (incluido NODE_ENV).
  for (const clave of Object.keys(process.env)) delete process.env[clave];
  Object.assign(process.env, COPIA);
});

/** Intenta arrancar; si arranca (hoy), cierra la aplicación y devuelve `{ arranco: true }`. */
async function intentarArrancar(): Promise<{ arranco: true } | { error: unknown }> {
  let app: INestApplication | undefined;
  try {
    app = await crearAplicacion({ logger: false });
  } catch (error) {
    return { error };
  }
  await app.close();
  return { arranco: true };
}

const mensajeDe = (resultado: { error: unknown } | { arranco: true }): string =>
  'error' in resultado
    ? ((resultado.error as Error | undefined)?.message ?? String(resultado.error))
    : '';

describe('criterio 29b · crearAplicacion exige NODE_ENV', () => {
  it('sin NODE_ENV no arranca y el mensaje menciona NODE_ENV y sus valores válidos', async () => {
    delete process.env.NODE_ENV;
    const resultado = await intentarArrancar();
    expect(resultado, 'la API arrancó sin NODE_ENV').toHaveProperty('error');
    const mensaje = mensajeDe(resultado);
    expect(mensaje).toContain('NODE_ENV');
    for (const valor of ['development', 'test', 'production']) expect(mensaje).toContain(valor);
  });

  it('con NODE_ENV vacío no arranca y el mensaje menciona NODE_ENV', async () => {
    process.env.NODE_ENV = '';
    const resultado = await intentarArrancar();
    expect(resultado, 'la API arrancó con NODE_ENV vacío').toHaveProperty('error');
    expect(mensajeDe(resultado)).toContain('NODE_ENV');
  });

  it.each(['staging', 'prod', 'Production', 'local'])(
    'con NODE_ENV=%s (valor inválido) no arranca y el mensaje menciona NODE_ENV',
    async (valor) => {
      process.env.NODE_ENV = valor;
      const resultado = await intentarArrancar();
      expect(resultado, `la API arrancó con NODE_ENV=${valor}`).toHaveProperty('error');
      expect(mensajeDe(resultado)).toContain('NODE_ENV');
    },
  );

  it('sin NODE_ENV y con EMPRESA_POR_HEADER=habilitado no arranca (no queda con el resolutor por cabecera)', async () => {
    delete process.env.NODE_ENV;
    process.env.EMPRESA_POR_HEADER = 'habilitado';
    const resultado = await intentarArrancar();
    expect(resultado, 'la API arrancó sin NODE_ENV y con la cabecera habilitada').toHaveProperty(
      'error',
    );
  });

  it.each(['development', 'test', 'production'] as const)(
    'control · NODE_ENV=%s explícito arranca',
    async (nodeEnv) => {
      fijarEntornoDePrueba({ nodeEnv, empresaPorHeader: nodeEnv !== 'production' });
      const resultado = await intentarArrancar();
      expect(resultado).toEqual({ arranco: true });
    },
  );
});

describe('criterio 29b · cargarEntorno exige NODE_ENV', () => {
  const base = {
    DATABASE_URL: 'postgres://restaurante_api:x@localhost:5432/restaurante_test',
    DATABASE_PLATAFORMA_URL: 'postgres://restaurante_plataforma:x@localhost:5432/restaurante_test',
  };

  it('sin NODE_ENV lanza y el mensaje menciona NODE_ENV y sus valores válidos', () => {
    let mensaje = '';
    try {
      cargarEntorno({ ...base });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje, 'cargarEntorno no lanzó sin NODE_ENV').toContain('NODE_ENV');
    for (const valor of ['development', 'test', 'production']) expect(mensaje).toContain(valor);
  });

  it('con NODE_ENV vacío lanza', () => {
    expect(() => cargarEntorno({ ...base, NODE_ENV: '' })).toThrow(/NODE_ENV/);
  });

  it('con NODE_ENV=staging lanza', () => {
    expect(() => cargarEntorno({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it.each(['development', 'test', 'production'])('control · NODE_ENV=%s es válido', (NODE_ENV) => {
    expect(cargarEntorno({ ...base, NODE_ENV }).NODE_ENV).toBe(NODE_ENV);
  });
});

describe('criterio 29b · las contraseñas por defecto solo con NODE_ENV development o test explícito', () => {
  const ADMIN = 'postgres://postgres:postgres@localhost:5432/postgres';

  it.each([
    ['sin NODE_ENV', {}],
    ['con NODE_ENV vacío', { NODE_ENV: '' }],
    ['con NODE_ENV=production', { NODE_ENV: 'production' }],
    ['con NODE_ENV=staging', { NODE_ENV: 'staging' }],
  ])('contrasenasDeRoles %s y sin DB_PASSWORD_* lanza nombrando la variable', (_nombre, env) => {
    expect(() => contrasenasDeRoles(env)).toThrow(/DB_PASSWORD_(MIGRADOR|API|PLATAFORMA)/);
  });

  it('urlParaRol sin NODE_ENV y sin DB_PASSWORD_* lanza nombrando la variable', () => {
    expect(() => urlParaRol(ADMIN, 'api', 'restaurante_test', {})).toThrow(/DB_PASSWORD_API/);
  });

  it.each(['development', 'test'])(
    'control · NODE_ENV=%s explícito usa las contraseñas por defecto',
    (NODE_ENV) => {
      expect(contrasenasDeRoles({ NODE_ENV })).toEqual({
        migrador: 'migrador_local',
        api: 'api_local',
        plataforma: 'plataforma_local',
      });
    },
  );

  it('control · sin NODE_ENV pero con las tres DB_PASSWORD_* definidas, las usa', () => {
    const env = {
      DB_PASSWORD_MIGRADOR: 'm',
      DB_PASSWORD_API: 'a',
      DB_PASSWORD_PLATAFORMA: 'p',
    };
    expect(contrasenasDeRoles(env)).toEqual({ migrador: 'm', api: 'a', plataforma: 'p' });
  });

  it('prepararBaseDeDatos sin NODE_ENV ni DB_PASSWORD_* falla nombrando la variable, antes de conectarse', async () => {
    // El administrador apunta a un puerto cerrado: si la función llegara a conectarse (y por tanto a
    // crear o modificar roles) el error sería de conexión y no el de la variable que falta.
    const error = await prepararBaseDeDatos({
      adminUrl: 'postgres://postgres:postgres@127.0.0.1:1/postgres',
      baseDeDatos: 'base_que_no_existe_29b',
      env: { DATABASE_ADMIN_URL: 'postgres://postgres:postgres@127.0.0.1:1/postgres' },
    }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error, 'prepararBaseDeDatos no falló').toBeDefined();
    expect(error!.message).toMatch(/DB_PASSWORD_(MIGRADOR|API|PLATAFORMA)/);
  });
});
