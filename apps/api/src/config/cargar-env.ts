import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Carga el `.env` de la raíz del monorepo (el que está junto a `pnpm-workspace.yaml`) si existe.
 * Las variables que ya están definidas en el entorno tienen prioridad y no se pisan.
 * La usan `main.ts` y los scripts; `crearAplicacion` solo lee `process.env`.
 */
export function cargarEnvDeLaRaiz(desde: string = process.cwd()): string | null {
  let directorio = desde;
  for (;;) {
    if (existsSync(join(directorio, 'pnpm-workspace.yaml'))) {
      const ruta = join(directorio, '.env');
      if (existsSync(ruta)) {
        process.loadEnvFile(ruta);
        return ruta;
      }
      return null;
    }
    const padre = dirname(directorio);
    if (padre === directorio) return null;
    directorio = padre;
  }
}
