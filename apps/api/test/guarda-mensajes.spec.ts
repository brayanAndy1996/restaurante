import type { INestApplication } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { CONEXION_API, ConsultaProhibidaError } from '../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from './utilidades';
import { crearEmpresaSql, type EmpresaSql } from './aislamiento/fabrica';

// Pruebas del desarrollador (no protegidas): el rechazo de la guarda no se hace pasar por un error de
// PostgreSQL, el mensaje de un texto no analizable es el genérico, y el archivo que define el texto de
// fijación (`nucleo/fijar-contexto.ts`) sigue las mismas reglas de lint que el servicio de contexto.

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let plataforma: Client;
let A: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 1 });
  app = await crearAplicacion({ logger: false });
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
});
afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

async function rechazo(sql: string): Promise<ConsultaProhibidaError> {
  return contexto.ejecutar(A.id, async () => {
    const error = await sequelize.query(sql).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConsultaProhibidaError);
    return error as ConsultaProhibidaError;
  });
}

describe('mensajes de la guarda de la API', () => {
  it('un nombre prohibido da el mensaje de nombres y no lleva el code de PostgreSQL', async () => {
    const error = await rechazo('SELECT lo_get(1)');
    expect(error.message).toMatch(/nombrar funciones ni objetos/);
    expect(error).not.toHaveProperty('code');
  });

  it.each([
    ['literal sin cerrar', `SELECT 'sin cerrar`],
    ['comentario sin cerrar', 'SELECT 1 /* sin cerrar'],
    ['dólar-comillas sin cerrar', 'SELECT $a$ sin cerrar'],
  ])('%s da el mensaje genérico, no el de nombre prohibido', async (_n, sql) => {
    const error = await rechazo(sql);
    expect(error.message).toMatch(/^Consulta no permitida/);
    expect(error.message).not.toMatch(/nombrar funciones/);
    expect(error).not.toHaveProperty('code');
  });
});

describe('lint del archivo que define el texto de fijación', () => {
  const RAIZ_API = resolve(__dirname, '..');
  const SRC = join(RAIZ_API, 'src');
  const eslint = new ESLint({ cwd: RAIZ_API });
  const REGLAS = new Set(['no-restricted-imports', 'no-restricted-syntax']);

  async function errores(archivo: string, codigo: string) {
    const [r] = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
    return (r?.messages ?? []).filter(
      (m) => m.severity === 2 && m.ruleId !== null && REGLAS.has(m.ruleId),
    );
  }

  const NOMBRE = `export const sql = 'SELECT fijar_contexto_empresa($1)';\n`;

  it('el archivo puede escribir el nombre de la función; otros archivos de nucleo/ no', async () => {
    expect(await errores('nucleo/fijar-contexto.ts', NOMBRE)).toEqual([]);
    expect((await errores('nucleo/base-de-datos/x.ts', NOMBRE)).length).toBeGreaterThan(0);
    expect((await errores('modulos/ventas/x.ts', NOMBRE)).length).toBeGreaterThan(0);
  });

  it.each([
    [
      'import estático',
      `import { SQL_FIJAR_CONTEXTO } from '../../nucleo/fijar-contexto';\nexport const s = SQL_FIJAR_CONTEXTO;\n`,
    ],
    [
      'import del nombre de la función',
      `import { NOMBRE_FUNCION_FIJAR_CONTEXTO as n } from '../../nucleo/fijar-contexto';\nexport const s = n;\n`,
    ],
    ['import dinámico', `export const c = () => import('../../nucleo/fijar-contexto');\n`],
    ['require', `export const c = require('../../nucleo/fijar-contexto');\n`],
  ])('fuera de nucleo/ no se puede cargar (%s)', async (_n, codigo) => {
    expect((await errores('modulos/ventas/x.ts', codigo)).length).toBeGreaterThan(0);
    expect((await errores('modulos/plataforma/x.ts', codigo)).length).toBeGreaterThan(0);
  });

  it('dentro de nucleo/ sí se puede importar', async () => {
    const codigo = `import { SQL_FIJAR_CONTEXTO } from '../fijar-contexto';\nexport const s = SQL_FIJAR_CONTEXTO;\n`;
    expect(await errores('nucleo/base-de-datos/x.ts', codigo)).toEqual([]);
  });
});
