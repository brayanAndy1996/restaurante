// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 22e inciso (f), regla de lint: la regla de los criterios 37, 22c y 37c también vale para el
// texto `fijar_contexto_empresa` (sin distinguir mayúsculas, también armado con `+`, plantillas sin
// expresiones, `.concat()` o `.join()` de literales). Fuera del servicio de contexto y de las migraciones,
// `pnpm lint` falla; en el servicio de contexto y en las migraciones pasa. Se analiza con `ESLint.lintText`
// y la configuración real de `apps/api`; solo cuentan los errores de `no-restricted-syntax` y
// `no-restricted-imports`.
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

const SERVICIO_DE_CONTEXTO = 'nucleo/contexto-empresa/contexto-empresa.ts';
const MIGRACION = 'migraciones/202610270002-contexto-empresa-unico.ts';

const FORMAS: [string, string][] = [
  ['literal con comillas simples', "export const sql = 'SELECT fijar_contexto_empresa($1)';\n"],
  ['literal con comillas dobles', 'export const sql = "SELECT fijar_contexto_empresa($1)";\n'],
  ['plantilla sin expresiones', 'export const sql = `SELECT fijar_contexto_empresa($1)`;\n'],
  ['el nombre solo', "export const nombre = 'fijar_contexto_empresa';\n"],
  ['con esquema', "export const sql = 'SELECT public.fijar_contexto_empresa($1)';\n"],
  ['en mayúsculas', "export const sql = 'SELECT FIJAR_CONTEXTO_EMPRESA($1)';\n"],
  [
    'con mayúsculas y minúsculas mezcladas',
    "export const sql = 'SELECT Fijar_Contexto_Empresa($1)';\n",
  ],
  ['concatenación con +', "export const k = 'fijar_contexto' + '_empresa';\n"],
  ['concatenación con + en tres partes', "export const k = 'fijar' + '_contexto' + '_empresa';\n"],
  ['concatenación con + en mayúsculas', "export const k = 'FIJAR_CONTEXTO' + '_EMPRESA';\n"],
  ['plantilla con una expresión literal', "export const k = `fijar_${'contexto_empresa'}`;\n"],
  ['.concat() sobre un literal', "export const k = 'fijar_contexto'.concat('_empresa');\n"],
  [
    '.concat() con varios argumentos',
    "export const k = 'fijar'.concat('_contexto', '_empresa');\n",
  ],
  ['.concat() en cadena', "export const k = 'fijar_'.concat('contexto').concat('_empresa');\n"],
  [
    ".join('') sobre un arreglo de literales",
    "export const k = ['fijar_contexto', '_empresa'].join('');\n",
  ],
  [
    ".join('_') sobre un arreglo de literales",
    "export const k = ['fijar', 'contexto', 'empresa'].join('_');\n",
  ],
  ['combinando .concat() y +', "export const k = 'fijar_contexto'.concat('_') + 'empresa';\n"],
];

describe('criterio 22e (f) · el texto fijar_contexto_empresa fuera del servicio de contexto y de las migraciones hace fallar el lint', () => {
  it.each(FORMAS)('%s en modulos/ventas/x.ts falla', async (_nombre, codigo) => {
    const errores = await erroresDelCriterio('modulos/ventas/x.ts', codigo);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each([
    'nucleo/base-de-datos/guarda-api.ts',
    'nucleo/base-de-datos/conexion-plataforma.ts',
    'nucleo/contexto-empresa/contexto-empresa.interceptor.ts',
    'nucleo/contexto-empresa/otro.ts',
    'modulos/plataforma/sucursal.service.ts',
    'app.module.ts',
  ])('el literal en %s (distinto del servicio de contexto) también falla', async (archivo) => {
    const errores = await erroresDelCriterio(
      archivo,
      "export const sql = 'SELECT fijar_contexto_empresa($1)';\n",
    );
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  describe('el servicio de contexto y las migraciones pueden tenerlo', () => {
    it.each(FORMAS)('%s en el servicio de contexto pasa', async (_nombre, codigo) => {
      expect(await erroresDelCriterio(SERVICIO_DE_CONTEXTO, codigo)).toEqual([]);
    });

    it.each(FORMAS)('%s en una migración pasa', async (_nombre, codigo) => {
      expect(await erroresDelCriterio(MIGRACION, codigo)).toEqual([]);
    });
  });

  describe('controles', () => {
    it.each([
      ['otra función', "export const sql = 'SELECT otra_funcion($1)';\n"],
      ['un prefijo parcial', "export const sql = 'fijar_contexto';\n"],
      ['concatenación de otros literales', "export const k = 'fijar_' + 'otra_cosa';\n"],
      ['.concat() de otros literales', "export const k = 'fijar_'.concat('otra_cosa');\n"],
      ['.join() de otros literales', "export const k = ['fijar', 'otra'].join('_');\n"],
    ])('%s no falla por esas reglas', async (_nombre, codigo) => {
      expect(await erroresDelCriterio('modulos/ventas/x.ts', codigo)).toEqual([]);
    });

    it('las reglas anteriores siguen vigentes: app.empresa_id fuera del servicio de contexto falla', async () => {
      const errores = await erroresDelCriterio(
        'modulos/ventas/x.ts',
        "export const sql = 'app.empresa_id';\n",
      );
      expect(errores.length).toBeGreaterThan(0);
    });
  });
});
