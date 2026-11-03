// Arranca el servidor autónomo de Next (`output: 'standalone'`) tal como corre en producción y en la imagen de Docker:
// `node .next/standalone/apps/web/server.js`. Next no copia solo `.next/static` ni `public` junto a ese servidor (lo
// hace el Dockerfile); aquí se copian antes de arrancar, para que la E2E y una prueba manual vean lo mismo que el
// contenedor. Construye primero con `pnpm build`.
//
//   pnpm start:autonomo          (puerto 3001, o el de PORT)
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const autonomo = join(web, '.next/standalone/apps/web');

if (!existsSync(join(autonomo, 'server.js'))) {
  console.error(
    'No se encontró el servidor autónomo. ¿Corriste `pnpm --filter @restaurante/web build`?',
  );
  process.exit(1);
}

cpSync(join(web, '.next/static'), join(autonomo, '.next/static'), { recursive: true });
if (existsSync(join(web, 'public'))) {
  cpSync(join(web, 'public'), join(autonomo, 'public'), { recursive: true });
}

process.env.PORT ??= '3001';
process.env.HOSTNAME ??= '0.0.0.0';
await import(pathToFileURL(join(autonomo, 'server.js')).href);
