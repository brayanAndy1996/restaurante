// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 22c (falla de la ronda 3 del adversarial): solo la transacción que abre
// `ContextoEmpresa.ejecutar` (sin un contexto activo) obtiene autorización para consultar. Dentro de
// `ejecutar(A, fn)`, código que abre OTRA transacción con `sequelize.transaction()` y en ella fija a
// mano una empresa (B o la propia A, con el mismo SQL de `ContextoEmpresa` o con variantes) no
// autoriza esa transacción: toda consulta que le mande lanza un error antes de llegar a la base
// (nunca un `DatabaseError`) y no devuelve filas de otra empresa. Lo mismo con una transacción
// abierta fuera de todo contexto. La transacción de A sigue funcionando.
// Desde el criterio 22e `ContextoEmpresa` fija la empresa con `SELECT fijar_contexto_empresa($1)`: las
// variantes con `set_config('app.empresa_id', …)` se conservan (siguen sin autorizar nada) y se agregan las
// de `fijar_contexto_empresa`, con el mismo resultado.
// La segunda parte (lint) comprueba que el texto SQL que fija el contexto no se puede importar desde
// fuera de `apps/api/src/nucleo/` y que la regla del texto `app.empresa_id` detecta también la
// concatenación de literales.
import type { INestApplication } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, type EmpresaSql } from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  // Pool de 3: el contexto de A usa una conexión y la transacción ajena otra; la tercera queda libre.
  fijarEntornoDePrueba({ poolMax: 3 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

/** SQL con el que `ContextoEmpresa` fijaba la empresa antes del criterio 22e (la prueba lo escribe por su cuenta). */
const SQL_FIJAR = "SELECT set_config('app.empresa_id', $1, true)";
/** SQL con el que `ContextoEmpresa` fija la empresa desde el criterio 22e (la prueba lo escribe por su cuenta). */
const SQL_FIJAR_FUNCION = 'SELECT fijar_contexto_empresa($1)';
/** Variantes de texto: ninguna debe autorizar la transacción ajena. */
const VARIANTES_FIJAR: { nombre: string; sql: string }[] = [
  { nombre: 'el texto exacto de ContextoEmpresa', sql: SQL_FIJAR },
  {
    nombre: 'en minúsculas y con espacios de más',
    sql: `select   set_config( 'app.empresa_id', $1, true )`,
  },
  { nombre: 'con punto y coma final', sql: `${SQL_FIJAR};` },
  { nombre: 'con comentario previo', sql: `/* ajeno */ ${SQL_FIJAR}` },
  { nombre: 'como SELECT … AS columna', sql: `SELECT set_config('app.empresa_id', $1, true) AS x` },
  { nombre: 'is_local = false', sql: `SELECT set_config('app.empresa_id', $1, false)` },
  { nombre: 'fijar_contexto_empresa (el texto exacto de ContextoEmpresa)', sql: SQL_FIJAR_FUNCION },
  {
    nombre: 'fijar_contexto_empresa en minúsculas y con espacios de más',
    sql: 'select   fijar_contexto_empresa( $1 )',
  },
  { nombre: 'FIJAR_CONTEXTO_EMPRESA en mayúsculas', sql: 'SELECT FIJAR_CONTEXTO_EMPRESA($1)' },
  {
    nombre: 'fijar_contexto_empresa con esquema public',
    sql: 'SELECT public.fijar_contexto_empresa($1)',
  },
  {
    nombre: 'fijar_contexto_empresa entre comillas dobles',
    sql: 'SELECT "fijar_contexto_empresa"($1)',
  },
  { nombre: 'fijar_contexto_empresa con punto y coma final', sql: `${SQL_FIJAR_FUNCION};` },
  {
    nombre: 'fijar_contexto_empresa con comentario previo',
    sql: `/* ajeno */ ${SQL_FIJAR_FUNCION}`,
  },
  {
    nombre: 'fijar_contexto_empresa como SELECT … AS columna',
    sql: 'SELECT fijar_contexto_empresa($1) AS x',
  },
];

const SQL_SUCURSALES = 'SELECT id, nombre FROM sucursal';
type Fila = { id: string; nombre: string };

const idsDe = (empresa: EmpresaSql) => new Set(empresa.sucursales.map((s) => s.id));
const nombresDe = (empresa: EmpresaSql) => empresa.sucursales.map((s) => s.nombre).sort();

async function capturar<T>(trabajo: () => Promise<T>): Promise<{ ok?: T; error?: unknown }> {
  try {
    return { ok: await trabajo() };
  } catch (error) {
    return { error };
  }
}

/**
 * Abre una transacción ajena con `sequelize.transaction()` (no gestionada), corre `uso` y la deja
 * limpia: ROLLBACK directo por la conexión del driver (la guarda puede impedir el `rollback()` de
 * Sequelize) y liberación de la conexión al pool. Si abrirla ya lanza, se considera rechazada de entrada.
 */
async function conTransaccionAjena(uso: (t2: Transaction) => Promise<void>): Promise<void> {
  let t2: Transaction;
  try {
    t2 = await sequelize.transaction();
  } catch {
    return; // rechazada al abrirla: nada que fugar
  }
  const cruda = (t2 as unknown as { connection?: { query(sql: string): Promise<unknown> } })
    .connection;
  try {
    await uso(t2);
  } finally {
    await cruda?.query('ROLLBACK').catch(() => undefined);
    await t2.rollback().catch(() => undefined);
    try {
      (t2 as unknown as { cleanup?: () => void }).cleanup?.();
    } catch {
      // ya liberada
    }
  }
}

/** Intenta fijar `empresaId` en `t2` con `sql` y leer sucursales; comprueba que nada se autorizó. */
async function exigirTransaccionNoAutorizada(
  t2: Transaction,
  sql: string,
  empresaId: string,
  ajena: EmpresaSql,
): Promise<void> {
  const fijar = await capturar(() => sequelize.query(sql, { bind: [empresaId], transaction: t2 }));
  const leer = await capturar(() =>
    sequelize.query<Fila>(SQL_SUCURSALES, { type: QueryTypes.SELECT, transaction: t2 }),
  );
  const filas = leer.ok ?? [];
  expect(
    filas.filter((f) => idsDe(ajena).has(f.id)),
    'la transacción ajena devolvió filas de otra empresa',
  ).toEqual([]);
  expect(
    leer.error,
    `la lectura por la transacción ajena debía lanzar un error y devolvió ${JSON.stringify(filas)}`,
  ).toBeInstanceOf(Error);
  expect(
    leer.error,
    'el rechazo debe ocurrir antes de llegar a la base (no un error de PostgreSQL)',
  ).not.toBeInstanceOf(DatabaseError);
  // La escritura tampoco debe llegar a la base.
  const escribir = await capturar(() =>
    sequelize.query(`UPDATE sucursal SET direccion = 'fuga' WHERE id = '${A.sucursales[0]!.id}'`, {
      transaction: t2,
    }),
  );
  expect(
    escribir.error,
    'la escritura por la transacción ajena debía lanzar un error',
  ).toBeInstanceOf(Error);
  expect(escribir.error).not.toBeInstanceOf(DatabaseError);
  if (fijar.error !== undefined) expect(fijar.error).not.toBeInstanceOf(DatabaseError);
}

async function sucursalesDelContexto(): Promise<Fila[]> {
  return sequelize.query<Fila>(SQL_SUCURSALES, { type: QueryTypes.SELECT });
}

describe('criterio 22c · una transacción abierta dentro de ejecutar(A) no se autoriza', () => {
  it('fijar B en la segunda transacción no la autoriza: toda consulta lanza y no devuelve filas de B', async () => {
    await contexto.ejecutar(A.id, async () => {
      await conTransaccionAjena(async (t2) => {
        await exigirTransaccionNoAutorizada(t2, SQL_FIJAR, B.id, B);
      });
    });
  });

  it('fijar la propia A en la segunda transacción tampoco la autoriza', async () => {
    await contexto.ejecutar(A.id, async () => {
      await conTransaccionAjena(async (t2) => {
        await exigirTransaccionNoAutorizada(t2, SQL_FIJAR, A.id, B);
        // Ni siquiera filas de A: la transacción ajena no está autorizada.
        const leer = await capturar(() =>
          sequelize.query<Fila>(SQL_SUCURSALES, { type: QueryTypes.SELECT, transaction: t2 }),
        );
        expect(leer.error, 'la transacción ajena con A fijada no debía poder leer').toBeInstanceOf(
          Error,
        );
      });
    });
  });

  it('fijar B con SELECT fijar_contexto_empresa($1) en la segunda transacción no la autoriza: toda consulta lanza y no devuelve filas de B', async () => {
    await contexto.ejecutar(A.id, async () => {
      await conTransaccionAjena(async (t2) => {
        await exigirTransaccionNoAutorizada(t2, SQL_FIJAR_FUNCION, B.id, B);
      });
    });
  });

  it('fijar la propia A con SELECT fijar_contexto_empresa($1) en la segunda transacción tampoco la autoriza', async () => {
    await contexto.ejecutar(A.id, async () => {
      await conTransaccionAjena(async (t2) => {
        await exigirTransaccionNoAutorizada(t2, SQL_FIJAR_FUNCION, A.id, B);
        const leer = await capturar(() =>
          sequelize.query<Fila>(SQL_SUCURSALES, { type: QueryTypes.SELECT, transaction: t2 }),
        );
        expect(leer.error, 'la transacción ajena con A fijada no debía poder leer').toBeInstanceOf(
          Error,
        );
      });
    });
  });

  it.each(VARIANTES_FIJAR)(
    'fijar B con $nombre no autoriza la segunda transacción',
    async ({ sql }) => {
      await contexto.ejecutar(A.id, async () => {
        await conTransaccionAjena(async (t2) => {
          await exigirTransaccionNoAutorizada(t2, sql, B.id, B);
        });
      });
    },
  );

  it('la transacción del contexto de A sigue funcionando y solo ve A, antes y después del intento', async () => {
    await contexto.ejecutar(A.id, async () => {
      expect((await sucursalesDelContexto()).map((f) => f.nombre).sort()).toEqual(nombresDe(A));
      await conTransaccionAjena(async (t2) => {
        await exigirTransaccionNoAutorizada(t2, SQL_FIJAR, B.id, B);
      });
      const despues = await sucursalesDelContexto();
      expect(despues.map((f) => f.nombre).sort()).toEqual(nombresDe(A));
      expect(despues.some((f) => idsDe(B).has(f.id))).toBe(false);
    });
  });

  it('el intento no deja escrita la fila de A ni confirma nada', async () => {
    const antes = await plataforma.query<{ direccion: string }>(
      'SELECT direccion FROM sucursal WHERE id = $1',
      [A.sucursales[0]!.id],
    );
    await contexto.ejecutar(A.id, async () => {
      await conTransaccionAjena(async (t2) => {
        await exigirTransaccionNoAutorizada(t2, SQL_FIJAR, B.id, B);
      });
    });
    const despues = await plataforma.query<{ direccion: string }>(
      'SELECT direccion FROM sucursal WHERE id = $1',
      [A.sucursales[0]!.id],
    );
    expect(despues.rows[0]!.direccion).toBe(antes.rows[0]!.direccion);
  });
});

describe('criterio 22c · una transacción abierta con sequelize.transaction() fuera de todo contexto', () => {
  it('fijar B en ella no la autoriza', async () => {
    await conTransaccionAjena(async (t2) => {
      await exigirTransaccionNoAutorizada(t2, SQL_FIJAR, B.id, B);
    });
  });

  it('fijar A en ella tampoco la autoriza', async () => {
    await conTransaccionAjena(async (t2) => {
      await exigirTransaccionNoAutorizada(t2, SQL_FIJAR, A.id, B);
      const leer = await capturar(() =>
        sequelize.query<Fila>(SQL_SUCURSALES, { type: QueryTypes.SELECT, transaction: t2 }),
      );
      expect(leer.error).toBeInstanceOf(Error);
    });
  });

  it('fijar B con SELECT fijar_contexto_empresa($1) en ella no la autoriza', async () => {
    await conTransaccionAjena(async (t2) => {
      await exigirTransaccionNoAutorizada(t2, SQL_FIJAR_FUNCION, B.id, B);
    });
  });

  it('fijar A con SELECT fijar_contexto_empresa($1) en ella tampoco la autoriza', async () => {
    await conTransaccionAjena(async (t2) => {
      await exigirTransaccionNoAutorizada(t2, SQL_FIJAR_FUNCION, A.id, B);
      const leer = await capturar(() =>
        sequelize.query<Fila>(SQL_SUCURSALES, { type: QueryTypes.SELECT, transaction: t2 }),
      );
      expect(leer.error).toBeInstanceOf(Error);
    });
  });

  it.each(VARIANTES_FIJAR)('con $nombre tampoco', async ({ sql }) => {
    await conTransaccionAjena(async (t2) => {
      await exigirTransaccionNoAutorizada(t2, sql, B.id, B);
    });
  });

  it('control · después de los intentos, ejecutar(B) sigue funcionando y solo ve B', async () => {
    const filas = await contexto.ejecutar(B.id, () => sucursalesDelContexto());
    expect(filas.map((f) => f.nombre).sort()).toEqual(nombresDe(B));
  });
});

describe('criterio 22c · lint: el SQL que fija el contexto no se importa desde fuera de nucleo/', () => {
  const RAIZ_API = resolve(__dirname, '..', '..');
  const SRC = join(RAIZ_API, 'src');
  const REGLAS = new Set(['no-restricted-imports', 'no-restricted-syntax']);
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint({ cwd: RAIZ_API });
  });

  async function erroresEn(archivo: string, codigo: string): Promise<string[]> {
    const resultados = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
    return resultados
      .flatMap((r) => r.messages)
      .filter((m) => m.severity === 2 && m.ruleId !== null && REGLAS.has(m.ruleId))
      .map((m) => `${m.ruleId}: ${m.message}`);
  }

  const DIRECTO = '../../nucleo/contexto-empresa/contexto-empresa';
  const BARRIL = '../../nucleo/contexto-empresa';

  it.each([
    ['archivo directo', DIRECTO],
    ['barril de la carpeta', BARRIL],
  ])(
    'un módulo de fuera de nucleo/ que importa SQL_FIJAR_CONTEXTO desde el %s falla el lint',
    async (_n, ruta) => {
      const codigo = `import { SQL_FIJAR_CONTEXTO } from '${ruta}';\nexport const sql = SQL_FIJAR_CONTEXTO;\n`;
      const errores = await erroresEn('modulos/ventas/x.ts', codigo);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    },
  );

  it.each([
    ['import dinámico', `export const cargar = () => import('${DIRECTO}');\n`],
    ['reexporte nombrado', `export { SQL_FIJAR_CONTEXTO } from '${DIRECTO}';\n`],
  ])(
    'forma de importación alternativa (%s) desde fuera de nucleo/ falla el lint',
    async (_n, codigo) => {
      const errores = await erroresEn('modulos/ventas/x.ts', codigo);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    },
  );

  it('control · importar otra cosa del barril (ContextoEmpresa) desde fuera no falla', async () => {
    const codigo = `import { ContextoEmpresa } from '${BARRIL}';\nexport const clase = ContextoEmpresa;\n`;
    expect(await erroresEn('modulos/ventas/x.ts', codigo)).toEqual([]);
  });

  it('control · la guarda de la API (nucleo/base-de-datos/guarda-api.ts) puede importarlo', async () => {
    const codigo = `import { SQL_FIJAR_CONTEXTO } from '../contexto-empresa/contexto-empresa';\nexport const sql = SQL_FIJAR_CONTEXTO;\n`;
    expect(await erroresEn('nucleo/base-de-datos/guarda-api.ts', codigo)).toEqual([]);
  });
});

describe('criterio 22c · lint: el texto app.empresa_id construido por concatenación de literales', () => {
  const RAIZ_API = resolve(__dirname, '..', '..');
  const SRC = join(RAIZ_API, 'src');
  const REGLAS = new Set(['no-restricted-imports', 'no-restricted-syntax']);
  let eslint: ESLint;
  beforeAll(() => {
    eslint = new ESLint({ cwd: RAIZ_API });
  });

  async function erroresEn(archivo: string, codigo: string): Promise<string[]> {
    const resultados = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
    return resultados
      .flatMap((r) => r.messages)
      .filter((m) => m.severity === 2 && m.ruleId !== null && REGLAS.has(m.ruleId))
      .map((m) => `${m.ruleId}: ${m.message}`);
  }

  it.each([
    ['concatenación con +', "export const k = 'app.' + 'empresa_id';\n"],
    ['plantilla con una expresión literal', "export const k = `app.${'empresa_id'}`;\n"],
    ['concatenación en tres partes', "export const k = 'app' + '.' + 'empresa_id';\n"],
  ])('%s fuera del servicio de contexto falla el lint', async (_n, codigo) => {
    const errores = await erroresEn('modulos/ventas/x.ts', codigo);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each([
    ['concatenación de otros literales', "export const k = 'app.' + 'otra_cosa';\n"],
    ['plantilla de otros literales', "export const k = `app.${'otra_cosa'}`;\n"],
  ])('control · %s no falla el lint', async (_n, codigo) => {
    expect(await erroresEn('modulos/ventas/x.ts', codigo)).toEqual([]);
  });
});
