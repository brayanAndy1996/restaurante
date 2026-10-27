// Criterio 37b (pruebas del desarrollador, complementan las protegidas de aislamiento/): otras formas
// de cargar la conexión de plataforma y comprobación de que ESLint analiza todas las extensiones.
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RAIZ_API = resolve(__dirname, '..');
const SRC = join(RAIZ_API, 'src');
let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: RAIZ_API });
});

async function mensajes(archivo: string, codigo: string) {
  const [resultado] = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
  return (resultado?.messages ?? []).filter(
    (m) =>
      m.severity === 2 &&
      (m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax'),
  );
}

const RUTA = '../../nucleo/base-de-datos/conexion-plataforma';

describe('criterio 37b · selectores adicionales', () => {
  it.each([
    [
      'import dinámico con plantilla sin variables',
      `export const c = () => import(\`${RUTA}\`);\n`,
    ],
    ['import dinámico con extensión .js', `export const c = () => import('${RUTA}.js');\n`],
    ['import dinámico con ruta calculada', `export const c = (r: string) => import(r);\n`],
    ['require con plantilla', `export const c = require(\`${RUTA}\`);\n`],
    ['require con ruta calculada', `export const c = (r: string) => require(r);\n`],
    ['import x = require()', `import c = require('${RUTA}');\nexport { c };\n`],
    ['tipo import()', `export type T = typeof import('${RUTA}');\n`],
    [
      'import de tipo',
      `import type { ConexionPlataforma } from '${RUTA}';\nexport type T = ConexionPlataforma;\n`,
    ],
  ])('%s fuera de plataforma falla', async (_nombre, codigo) => {
    const errores = await mensajes('modulos/ventas/x.ts', codigo);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.every((m) => m.ruleId !== null)).toBe(true);
  });

  it('un import dinámico de una ruta fija inofensiva no falla', async () => {
    expect(
      await mensajes('modulos/ventas/x.ts', `export const c = () => import('./otro');\n`),
    ).toEqual([]);
    expect(await mensajes('modulos/ventas/x.ts', `export const c = require('./otro');\n`)).toEqual(
      [],
    );
  });

  it('dentro de plataforma todo está permitido', async () => {
    const codigo = `export const c = (r: string) => import(r);\nexport const d = () => import('${RUTA}');\n`;
    expect(await mensajes('modulos/plataforma/x.ts', codigo)).toEqual([]);
  });

  it('el servicio de contexto puede escribir el parámetro; las migraciones también; los demás .tsx no', async () => {
    const codigo = `export const sql = "SELECT set_config('app.empresa_id', $1, true)";\n`;
    expect(await mensajes('nucleo/contexto-empresa/contexto-empresa.ts', codigo)).toEqual([]);
    expect(await mensajes('migraciones/x.mts', codigo)).toEqual([]);
    expect((await mensajes('modulos/plataforma/x.tsx', codigo)).length).toBeGreaterThan(0);
  });

  it('el nombre de la función que fija el contexto sigue la misma regla (criterio 22e)', async () => {
    const codigo = `export const sql = 'SELECT fijar_contexto_empresa($1)';\n`;
    expect(await mensajes('nucleo/contexto-empresa/contexto-empresa.ts', codigo)).toEqual([]);
    expect(await mensajes('migraciones/x.mts', codigo)).toEqual([]);
    expect((await mensajes('modulos/plataforma/x.tsx', codigo)).length).toBeGreaterThan(0);
    expect((await mensajes('nucleo/base-de-datos/x.ts', codigo)).length).toBeGreaterThan(0);
  });

  it.each(['ts', 'tsx', 'mts', 'cts'])(
    'ESLint analiza archivos .%s de src (no «File ignored»)',
    async (ext) => {
      const [resultado] = await eslint.lintText('export const a = 1;\n', {
        filePath: join(SRC, `modulos/ventas/x.${ext}`),
      });
      expect(resultado?.messages.map((m) => m.message).join()).not.toMatch(/ignored/i);
      expect(resultado?.messages).toEqual([]);
    },
  );
});

describe('criterio 22c · textos calculados y alcance de las reglas del contexto', () => {
  const CONTEXTO = '../../nucleo/contexto-empresa/contexto-empresa';
  const AUTORIZACION = '../../nucleo/base-de-datos/autorizacion-transaccion';

  it.each([
    ['partida en el medio de una palabra', "export const k = 'app.empresa' + '_id';\n"],
    ['en cinco partes', "export const k = 'a' + 'pp' + '.' + 'empresa' + '_id';\n"],
    ['con una plantilla y una concatenación', "export const k = `app.${'empresa' + '_id'}`;\n"],
    ['con mayúsculas', "export const k = 'APP.' + 'Empresa_ID';\n"],
    [
      'entre paréntesis y con as',
      "export const k = ('app.' as string) + ('empresa_id' as string);\n",
    ],
    [
      'en la ruta de un import() de la conexión de plataforma',
      "export const c = () => import('../../nucleo/base-de-datos/conexion-' + 'plataforma');\n",
    ],
  ])('el texto armado %s falla', async (_nombre, codigo) => {
    expect((await mensajes('modulos/ventas/x.ts', codigo)).length).toBeGreaterThan(0);
  });

  it('una concatenación con una variable no se puede calcular y no falla', async () => {
    const codigo = "export const k = (x: string) => 'app.' + x + 'empresa_id';\n";
    expect(await mensajes('modulos/ventas/x.ts', codigo)).toEqual([]);
  });

  it.each([
    ['import * del archivo', `import * as c from '${CONTEXTO}';\nexport const s = c;\n`],
    ['export * del archivo', `export * from '${CONTEXTO}';\n`],
    ['require del archivo', `export const c = require('${CONTEXTO}');\n`],
    [
      'propiedad con el nombre armado',
      `export const f = (c: Record<string, string>) => c['SQL_FIJAR_' + 'CONTEXTO'];\n`,
    ],
    [
      'propiedad de un espacio de nombres',
      `export const f = (c: { SQL_FIJAR_CONTEXTO: string }) => c.SQL_FIJAR_CONTEXTO;\n`,
    ],
    [
      'registro de autorización (import)',
      `import { consumirPendienteDeAutorizar } from '${AUTORIZACION}';\nexport const f = consumirPendienteDeAutorizar;\n`,
    ],
    ['registro de autorización (import())', `export const f = () => import('${AUTORIZACION}');\n`],
  ])('fuera de nucleo/: %s falla', async (_nombre, codigo) => {
    expect((await mensajes('modulos/ventas/x.ts', codigo)).length).toBeGreaterThan(0);
  });

  it('el módulo de plataforma tampoco puede importar el texto SQL del contexto', async () => {
    const codigo = `import { SQL_FIJAR_CONTEXTO } from '${CONTEXTO}';\nexport const s = SQL_FIJAR_CONTEXTO;\n`;
    expect((await mensajes('modulos/plataforma/x.ts', codigo)).length).toBeGreaterThan(0);
  });

  it('dentro de nucleo/ se pueden usar ambos', async () => {
    const codigo =
      `import { SQL_FIJAR_CONTEXTO } from '../contexto-empresa/contexto-empresa';\n` +
      `import { consumirPendienteDeAutorizar } from './autorizacion-transaccion';\n` +
      `export const f = [SQL_FIJAR_CONTEXTO, consumirPendienteDeAutorizar];\n`;
    expect(await mensajes('nucleo/base-de-datos/x.ts', codigo)).toEqual([]);
  });
});
