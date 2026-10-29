import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import type { ContextoMigracion } from '../../src/migraciones/tipos';

export const CARPETA_MIGRACIONES = join(__dirname, '..', '..', 'src', 'migraciones');
export const TABLA_MIGRACIONES = 'migraciones';

interface ModuloMigracion {
  up: (contexto: ContextoMigracion) => Promise<void>;
  down: (contexto: ContextoMigracion) => Promise<void>;
}

/**
 * Umzug sobre la conexión del migrador. Descubre `src/migraciones/AAAAMMDDHHMM-descripcion.ts`
 * (o `.js` si ya está compilado); con la carpeta vacía no hace nada. Cada migración corre en su
 * propia transacción (no sirve para `CREATE INDEX CONCURRENTLY`).
 */
export function crearUmzug(sequelize: Sequelize, carpeta: string = CARPETA_MIGRACIONES) {
  return new Umzug<Sequelize>({
    migrations: {
      glob: ['[0-9]*-*.{ts,js}', { cwd: carpeta, ignore: ['**/*.d.ts'] }],
      resolve: ({ name, path }) => {
        // En Windows, `import()` no acepta rutas como `C:\...`: hay que pasarle una URL `file://`.
        const cargar = async () =>
          (await import(pathToFileURL(path as string).href)) as ModuloMigracion;
        return {
          name,
          path,
          up: async () => {
            const modulo = await cargar();
            await sequelize.transaction((transaction) => modulo.up({ sequelize, transaction }));
          },
          down: async () => {
            const modulo = await cargar();
            await sequelize.transaction((transaction) => modulo.down({ sequelize, transaction }));
          },
        };
      },
    },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize, tableName: TABLA_MIGRACIONES }),
    logger: undefined,
  });
}

async function conMigrador<T>(
  urlMigrador: string,
  carpeta: string | undefined,
  fn: (umzug: ReturnType<typeof crearUmzug>) => Promise<T>,
): Promise<T> {
  const sequelize = new Sequelize(urlMigrador, { dialect: 'postgres', logging: false });
  try {
    return await fn(crearUmzug(sequelize, carpeta));
  } finally {
    await sequelize.close();
  }
}

/** Aplica las migraciones pendientes; devuelve los nombres aplicados. */
export function migrarArriba(urlMigrador: string, carpeta?: string): Promise<string[]> {
  return conMigrador(urlMigrador, carpeta, async (umzug) =>
    (await umzug.up()).map((migracion) => migracion.name),
  );
}

/** Revierte la última migración aplicada; devuelve su nombre (o `null` si no había). */
export function revertirUltima(urlMigrador: string, carpeta?: string): Promise<string | null> {
  return conMigrador(urlMigrador, carpeta, async (umzug) => {
    const revertidas = await umzug.down();
    return revertidas[0]?.name ?? null;
  });
}
