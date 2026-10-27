// spec: 001-base-multitenancy (pruebas protegidas)
//
// P7 · Criterio 37: `ESLint.lintText` sobre fragmentos que importan la conexión de plataforma fuera de
// su módulo o escriben el texto `app.empresa_id` fuera del servicio de contexto. No se ejecuta
// `pnpm lint` entero: se usa la configuración real de `apps/api` con archivos ficticios.
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const RAIZ_API = resolve(__dirname, '..', '..');
const SRC = join(RAIZ_API, 'src');

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: RAIZ_API });
});

/** Errores (severidad 2) que ESLint encuentra en `codigo` si viviera en `archivo` (relativo a src/). */
async function erroresEn(archivo: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: join(SRC, archivo) });
  return (resultado?.messages ?? [])
    .filter((m) => m.severity === 2)
    .map((m) => `${m.ruleId ?? 'análisis'}: ${m.message}`);
}

const importaConexion = (rutaRelativa: string) =>
  `import { CONEXION_PLATAFORMA } from '${rutaRelativa}';\nexport const token = CONEXION_PLATAFORMA;\n`;

describe('criterio 37 · la conexión de plataforma solo se importa dentro de modulos/plataforma', () => {
  it.each([
    ['modulos/salud/salud.controller.ts', '../../nucleo/base-de-datos/conexion-plataforma'],
    ['modulos/otro/otro.service.ts', '../../nucleo/base-de-datos/conexion-plataforma'],
    ['nucleo/contexto-empresa/otro.ts', '../base-de-datos/conexion-plataforma'],
    ['app.module.ts', './nucleo/base-de-datos/conexion-plataforma'],
  ])('un archivo fuera (%s) que la importa hace fallar el lint', async (archivo, ruta) => {
    const errores = await erroresEn(archivo, importaConexion(ruta));
    expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
  });

  it.each([
    ['modulos/plataforma/plataforma.module.ts', '../../nucleo/base-de-datos/conexion-plataforma'],
    ['modulos/plataforma/modelos/empresa.ts', '../../../nucleo/base-de-datos/conexion-plataforma'],
  ])('un archivo dentro (%s) que la importa no falla', async (archivo, ruta) => {
    expect(await erroresEn(archivo, importaConexion(ruta))).toEqual([]);
  });

  it('un archivo fuera que importa otra cosa de la misma carpeta no falla', async () => {
    const codigo = `import { Sequelize } from 'sequelize';\nexport const tipo = Sequelize;\n`;
    expect(await erroresEn('modulos/otro/otro.service.ts', codigo)).toEqual([]);
  });
});

describe('criterio 37 · solo el servicio de contexto escribe el texto app.empresa_id', () => {
  const textoSimple = `export const sql = "SELECT set_config('app.empresa_id', $1, true)";\n`;
  const textoComillasSimples = `export const sql = 'SET LOCAL app.empresa_id = 1';\n`;
  const textoPlantilla =
    "export const sql = (empresaId: string) => `SET LOCAL app.empresa_id = '${empresaId}'`;\n";

  it.each([
    ['modulos/plataforma/sucursal.service.ts', textoSimple],
    ['modulos/otro/otro.service.ts', textoComillasSimples],
    ['nucleo/base-de-datos/otro.ts', textoPlantilla],
    ['nucleo/contexto-empresa/contexto-empresa.interceptor.ts', textoSimple],
  ])(
    'un archivo distinto del servicio de contexto (%s) que lo escribe hace fallar el lint',
    async (archivo, codigo) => {
      const errores = await erroresEn(archivo, codigo);
      expect(errores.length, 'el lint debería fallar').toBeGreaterThan(0);
    },
  );

  it.each([
    ['literal con comillas dobles', textoSimple],
    ['literal con comillas simples', textoComillasSimples],
    ['plantilla de texto', textoPlantilla],
  ])(
    'el servicio de contexto (contexto-empresa.ts) puede escribirlo: %s',
    async (_nombre, codigo) => {
      expect(await erroresEn('nucleo/contexto-empresa/contexto-empresa.ts', codigo)).toEqual([]);
    },
  );

  it('un archivo que no escribe ese texto no falla', async () => {
    const codigo = `export const sql = "SELECT set_config('app.otro_parametro', $1, true)";\n`;
    expect(await erroresEn('modulos/otro/otro.service.ts', codigo)).toEqual([]);
  });
});
