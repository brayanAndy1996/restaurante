// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Regla de lint de plan.md ("Módulos afectados", `src/nucleo/fijar-contexto.ts` y `eslint.config.js`) y de
// la tarea T7: el texto `fijar_contexto_actor` recibe el mismo trato que `fijar_contexto_empresa` en
// 001 (criterios 37, 22c, 22e). Solo lo escribe el archivo autorizado de `src/nucleo/`
// (`src/nucleo/fijar-contexto.ts`, el que define `SQL_FIJAR_ACTOR`) y las migraciones; en cualquier otro
// archivo de `src/` `pnpm lint` falla, sin distinguir mayúsculas y también armado con `+`, plantillas,
// `.concat()` o `.join()` de literales. La constante `SQL_FIJAR_ACTOR` se usa solo dentro de
// `src/nucleo/`. Se analiza con `ESLint.lintText` y la configuración real de `apps/api`; solo cuentan los
// errores de `no-restricted-syntax` y `no-restricted-imports`.
//
// Nota: `plan.md` nombra `src/nucleo/fijar-contexto.ts` como el archivo que agrega `SQL_FIJAR_ACTOR` y su
// nombre; el servicio de contexto (`contexto-empresa.ts`) y `consultas-sin-empresa.ts` no se
// ejercitan aquí porque el plan no dice si el texto del actor puede escribirse en ellos.
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RAIZ_API = resolve(__dirname, '..', '..');
const SRC = join(RAIZ_API, 'src');
const REGLAS_DEL_CRITERIO = new Set(['no-restricted-imports', 'no-restricted-syntax']);

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: RAIZ_API });
});

async function erroresDelCriterio(archivo: string, codigo: string): Promise<string[]> {
  const resultados = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
  return resultados
    .flatMap((r) => r.messages)
    .filter((m) => m.severity === 2 && m.ruleId !== null && REGLAS_DEL_CRITERIO.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

const ARCHIVO_AUTORIZADO = 'nucleo/fijar-contexto.ts';
const MIGRACION = 'migraciones/202610270002-contexto-empresa-unico.ts';

const FORMAS: [string, string][] = [
  [
    'literal con comillas simples',
    "export const sql = 'SELECT fijar_contexto_actor($1, $2, $3, $4)';\n",
  ],
  [
    'literal con comillas dobles',
    'export const sql = "SELECT fijar_contexto_actor($1, $2, $3, $4)";\n',
  ],
  [
    'plantilla sin expresiones',
    'export const sql = `SELECT fijar_contexto_actor($1, $2, $3, $4)`;\n',
  ],
  ['el nombre solo', "export const nombre = 'fijar_contexto_actor';\n"],
  ['con esquema', "export const sql = 'SELECT public.fijar_contexto_actor($1, $2, $3, $4)';\n"],
  ['en mayúsculas', "export const sql = 'SELECT FIJAR_CONTEXTO_ACTOR($1, $2, $3, $4)';\n"],
  [
    'con mayúsculas y minúsculas mezcladas',
    "export const sql = 'SELECT Fijar_Contexto_Actor($1, $2, $3, $4)';\n",
  ],
  ['concatenación con +', "export const k = 'fijar_contexto' + '_actor';\n"],
  ['concatenación con + en tres partes', "export const k = 'fijar' + '_contexto' + '_actor';\n"],
  ['concatenación con + en mayúsculas', "export const k = 'FIJAR_CONTEXTO' + '_ACTOR';\n"],
  ['plantilla con una expresión literal', "export const k = `fijar_${'contexto_actor'}`;\n"],
  ['.concat() sobre un literal', "export const k = 'fijar_contexto'.concat('_actor');\n"],
  ['.concat() con varios argumentos', "export const k = 'fijar'.concat('_contexto', '_actor');\n"],
  ['.concat() en cadena', "export const k = 'fijar_'.concat('contexto').concat('_actor');\n"],
  [
    ".join('') sobre un arreglo de literales",
    "export const k = ['fijar_contexto', '_actor'].join('');\n",
  ],
  [
    ".join('_') sobre un arreglo de literales",
    "export const k = ['fijar', 'contexto', 'actor'].join('_');\n",
  ],
  ['combinando .concat() y +', "export const k = 'fijar_contexto'.concat('_') + 'actor';\n"],
];

describe('regla de lint · el texto fijar_contexto_actor fuera del archivo autorizado de src/nucleo/ y de las migraciones hace fallar el lint', () => {
  it.each(FORMAS)('%s en modulos/ventas/x.ts falla', async (_nombre, codigo) => {
    const errores = await erroresDelCriterio('modulos/ventas/x.ts', codigo);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each([
    'nucleo/base-de-datos/guarda-api.ts',
    'nucleo/base-de-datos/conexion-plataforma.ts',
    'nucleo/contexto-empresa/contexto-empresa.interceptor.ts',
    'nucleo/contexto-empresa/otro.ts',
    'nucleo/principal/principal.interceptor.ts',
    'modulos/plataforma/sucursal.service.ts',
    'modulos/seguridad/sesiones.service.ts',
    'modulos/auditoria/auditoria.service.ts',
    'app.module.ts',
  ])('el literal en %s (distinto del archivo autorizado) también falla', async (archivo) => {
    const errores = await erroresDelCriterio(
      archivo,
      "export const sql = 'SELECT fijar_contexto_actor($1, $2, $3, $4)';\n",
    );
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  describe('el archivo autorizado de src/nucleo/ y las migraciones pueden tenerlo', () => {
    it.each(FORMAS)('%s en nucleo/fijar-contexto.ts pasa', async (_nombre, codigo) => {
      expect(await erroresDelCriterio(ARCHIVO_AUTORIZADO, codigo)).toEqual([]);
    });

    it.each(FORMAS)('%s en una migración pasa', async (_nombre, codigo) => {
      expect(await erroresDelCriterio(MIGRACION, codigo)).toEqual([]);
    });
  });

  describe('la constante SQL_FIJAR_ACTOR solo se usa dentro de src/nucleo/', () => {
    it.each([
      ['como identificador', 'export const s = SQL_FIJAR_ACTOR;\n'],
      [
        'como propiedad de un objeto',
        'export const f = (c: { SQL_FIJAR_ACTOR: string }) => c.SQL_FIJAR_ACTOR;\n',
      ],
      ['como texto', "export const n = 'SQL_FIJAR_ACTOR';\n"],
      [
        'importada del archivo autorizado',
        "import { SQL_FIJAR_ACTOR } from '../../nucleo/fijar-contexto';\nexport const s = SQL_FIJAR_ACTOR;\n",
      ],
      [
        'reexportada del archivo autorizado',
        "export { SQL_FIJAR_ACTOR } from '../../nucleo/fijar-contexto';\n",
      ],
      [
        'importada con import * del archivo autorizado',
        "import * as f from '../../nucleo/fijar-contexto';\nexport const s = f.SQL_FIJAR_ACTOR;\n",
      ],
      [
        'importada con import() dinámico',
        "export const m = () => import('../../nucleo/fijar-contexto');\n",
      ],
    ])('%s en modulos/ventas/x.ts falla', async (_nombre, codigo) => {
      const errores = await erroresDelCriterio('modulos/ventas/x.ts', codigo);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    });

    it.each([
      'modulos/plataforma/operacion.ts',
      'modulos/seguridad/sesiones.service.ts',
      'modulos/auditoria/auditoria.service.ts',
    ])('el identificador en %s falla', async (archivo) => {
      const errores = await erroresDelCriterio(archivo, 'export const s = SQL_FIJAR_ACTOR;\n');
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    });

    it.each([
      'nucleo/fijar-contexto.ts',
      'nucleo/base-de-datos/guarda-api.ts',
      'nucleo/base-de-datos/conexion-plataforma.ts',
      'nucleo/contexto-empresa/contexto-empresa.ts',
    ])('el identificador en %s (dentro de src/nucleo/) pasa', async (archivo) => {
      expect(await erroresDelCriterio(archivo, 'export const s = SQL_FIJAR_ACTOR;\n')).toEqual([]);
    });

    it('importarla del archivo autorizado desde otro archivo de src/nucleo/ pasa', async () => {
      expect(
        await erroresDelCriterio(
          'nucleo/contexto-empresa/contexto-empresa.ts',
          "import { SQL_FIJAR_ACTOR } from '../fijar-contexto';\nexport const s = SQL_FIJAR_ACTOR;\n",
        ),
      ).toEqual([]);
    });
  });

  describe('controles', () => {
    it.each([
      ['otra función', "export const sql = 'SELECT otra_funcion($1)';\n"],
      ['un prefijo parcial', "export const sql = 'fijar_contexto';\n"],
      ['un nombre parecido', "export const sql = 'fijar_contexto_actores';\n"],
      ['concatenación de otros literales', "export const k = 'fijar_' + 'otra_cosa';\n"],
      ['.concat() de otros literales', "export const k = 'fijar_'.concat('otra_cosa');\n"],
      ['.join() de otros literales', "export const k = ['fijar', 'otra'].join('_');\n"],
      ['otro identificador', 'export const s = SQL_FIJAR_OTRA_COSA;\n'],
    ])('%s no falla por esas reglas', async (_nombre, codigo) => {
      expect(await erroresDelCriterio('modulos/ventas/x.ts', codigo)).toEqual([]);
    });

    it('las reglas de 001 siguen vigentes: fijar_contexto_empresa fuera del archivo autorizado falla', async () => {
      const errores = await erroresDelCriterio(
        'modulos/ventas/x.ts',
        "export const sql = 'SELECT fijar_contexto_empresa($1)';\n",
      );
      expect(errores.length).toBeGreaterThan(0);
    });

    it('las reglas de 001 siguen vigentes: app.empresa_id fuera del servicio de contexto falla', async () => {
      const errores = await erroresDelCriterio(
        'modulos/ventas/x.ts',
        "export const sql = 'app.empresa_id';\n",
      );
      expect(errores.length).toBeGreaterThan(0);
    });
  });
});
