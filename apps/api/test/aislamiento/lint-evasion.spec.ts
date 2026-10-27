// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 37 (falla F4 del adversarial): las reglas de lint que protegen el aislamiento no deben
// poder evadirse con otra forma de importar o de escribir el texto prohibido: import dinámico,
// `require`, reexportes, y archivos `.mts`, `.cts` y `.tsx`. Todas las variantes se analizan con
// `ESLint.lintText` y la configuración real de `apps/api`; deben fallar por las reglas del criterio
// (`no-restricted-imports` o `no-restricted-syntax`), no por un error de análisis ni por ignorar el
// archivo. Los controles dentro de `modulos/plataforma/` no deben fallar por esas reglas.
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
  const mensajes = resultados.flatMap((r) => r.messages);
  return mensajes
    .filter((m) => m.severity === 2 && m.ruleId !== null && REGLAS_DEL_CRITERIO.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

const RUTA = '../../nucleo/base-de-datos/conexion-plataforma';
const EXTENSIONES = ['ts', 'mts', 'cts', 'tsx'] as const;

describe('criterio 37 · la conexión de plataforma no se evade fuera de modulos/plataforma', () => {
  const importDinamico = `export const cargar = () => import('${RUTA}');\n`;
  const importEstatico = `import { CONEXION_PLATAFORMA } from '${RUTA}';\nexport const token = CONEXION_PLATAFORMA;\n`;
  const requerir = `const { CONEXION_PLATAFORMA } = require('${RUTA}');\nexport const token = CONEXION_PLATAFORMA;\n`;
  const reexporteTodo = `export * from '${RUTA}';\n`;
  const reexporteNombrado = `export { CONEXION_PLATAFORMA } from '${RUTA}';\n`;

  it('import dinámico desde un .ts fuera hace fallar el lint', async () => {
    const errores = await erroresDelCriterio('modulos/ventas/x.ts', importDinamico);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each(EXTENSIONES)(
    'import estático desde un archivo .%s fuera hace fallar el lint',
    async (ext) => {
      const errores = await erroresDelCriterio(`modulos/ventas/x.${ext}`, importEstatico);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    },
  );

  it('require desde un .ts fuera hace fallar el lint', async () => {
    const errores = await erroresDelCriterio('modulos/ventas/x.ts', requerir);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each([
    ['export * from', reexporteTodo],
    ['export { CONEXION_PLATAFORMA } from', reexporteNombrado],
  ])('reexporte (%s) desde un .ts fuera hace fallar el lint', async (_nombre, codigo) => {
    const errores = await erroresDelCriterio('modulos/ventas/x.ts', codigo);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each([
    ['export * from', reexporteTodo],
    ['export { CONEXION_PLATAFORMA } from', reexporteNombrado],
  ])('reexporte (%s) desde un .mts fuera hace fallar el lint', async (_nombre, codigo) => {
    const errores = await erroresDelCriterio('modulos/ventas/x.mts', codigo);
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  describe('controles · dentro de modulos/plataforma no fallan por esas reglas', () => {
    it.each(EXTENSIONES)('import estático desde un archivo .%s', async (ext) => {
      const errores = await erroresDelCriterio(`modulos/plataforma/x.${ext}`, importEstatico);
      expect(errores).toEqual([]);
    });

    it('import dinámico, require y reexportes desde un .ts', async () => {
      for (const codigo of [importDinamico, requerir, reexporteTodo, reexporteNombrado]) {
        expect(await erroresDelCriterio('modulos/plataforma/x.ts', codigo)).toEqual([]);
      }
    });
  });
});

describe('criterio 37 · el texto app.empresa_id no se evade con otras extensiones', () => {
  const comillas = `export const sql = "SELECT set_config('app.empresa_id', $1, true)";\n`;
  const plantilla =
    "export const sql = (empresaId: string) => `SET LOCAL app.empresa_id = '${empresaId}'`;\n";

  it.each(['tsx', 'cts', 'mts'] as const)(
    'el literal entre comillas en un archivo .%s fuera del servicio de contexto hace fallar el lint',
    async (ext) => {
      const errores = await erroresDelCriterio(`modulos/ventas/y.${ext}`, comillas);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    },
  );

  it.each(['tsx', 'cts', 'mts'] as const)(
    'la plantilla de texto en un archivo .%s fuera del servicio de contexto hace fallar el lint',
    async (ext) => {
      const errores = await erroresDelCriterio(`modulos/ventas/y.${ext}`, plantilla);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    },
  );

  it('control · un archivo .ts que no escribe ese texto no falla', async () => {
    const codigo = `export const sql = "SELECT set_config('app.otro_parametro', $1, true)";\n`;
    expect(await erroresDelCriterio('modulos/ventas/y.ts', codigo)).toEqual([]);
  });
});
