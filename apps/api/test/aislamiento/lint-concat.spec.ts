// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 37c (falla media de la ronda 4 del adversarial): la regla de lint que reserva el texto
// `app.empresa_id` al servicio de contexto no puede evadirse construyendo el texto con `concat` o con
// `join` (`'app.'.concat('empresa_id')`, `['app', 'empresa_id'].join('.')`, ...). Se analiza con
// `ESLint.lintText` y la configuración real de `apps/api`; solo cuentan los errores de
// `no-restricted-syntax` y `no-restricted-imports`. El archivo del servicio de contexto puede tenerlo.
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

/** Errores de las reglas del criterio 37 que ESLint encuentra en `codigo` si viviera en `archivo`. */
async function erroresDelCriterio(archivo: string, codigo: string): Promise<string[]> {
  const resultados = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
  return resultados
    .flatMap((r) => r.messages)
    .filter((m) => m.severity === 2 && m.ruleId !== null && REGLAS_DEL_CRITERIO.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

const SERVICIO_DE_CONTEXTO = 'nucleo/contexto-empresa/contexto-empresa.ts';

describe('criterio 37c · el texto app.empresa_id no se construye con concat ni join fuera del servicio de contexto', () => {
  it.each([
    ["'app.'.concat('empresa_id')", "const k = 'app.'.concat('empresa_id');\n"],
    ["'app'.concat('.', 'empresa_id')", "const k = 'app'.concat('.', 'empresa_id');\n"],
    ["['app.', 'empresa_id'].join('')", "const k = ['app.', 'empresa_id'].join('');\n"],
    ["['app', 'empresa_id'].join('.')", "const k = ['app', 'empresa_id'].join('.');\n"],
  ])('%s hace fallar el lint en modulos/ventas/x.ts', async (_nombre, codigo) => {
    const errores = await erroresDelCriterio('modulos/ventas/x.ts', codigo);
    expect(errores.length, 'el lint debería fallar con no-restricted-syntax').toBeGreaterThan(0);
    expect(errores.some((e) => e.startsWith('no-restricted-syntax'))).toBe(true);
  });

  describe('controles', () => {
    it.each([
      ["'app.'.concat('otra')", "const k = 'app.'.concat('otra');\n"],
      ["['a', 'b'].join('')", "const k = ['a', 'b'].join('');\n"],
    ])('%s no falla por esas reglas', async (_nombre, codigo) => {
      expect(await erroresDelCriterio('modulos/ventas/x.ts', codigo)).toEqual([]);
    });

    it('el archivo del servicio de contexto puede tener el literal y las formas construidas', async () => {
      for (const codigo of [
        "const k = 'app.empresa_id';\n",
        "const k = 'app.'.concat('empresa_id');\n",
        "const k = ['app', 'empresa_id'].join('.');\n",
      ]) {
        expect(await erroresDelCriterio(SERVICIO_DE_CONTEXTO, codigo)).toEqual([]);
      }
    });
  });
});
