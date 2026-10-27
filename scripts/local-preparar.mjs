// Deja el entorno local listo con Docker: PostgreSQL 16, roles, base migrada y datos de demostración.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ejecutar = (comando) => execSync(comando, { cwd: raiz, stdio: 'inherit' });

if (!existsSync(join(raiz, '.env'))) {
  copyFileSync(join(raiz, '.env.example'), join(raiz, '.env'));
  console.log('Se creó .env a partir de .env.example');
}

ejecutar('docker compose up -d --wait');
ejecutar('pnpm db:preparar');
ejecutar('pnpm db:migrar');
// La semilla usa los paquetes compartidos (`dominio` y `contratos`), que se exportan desde `dist/`
// y no se versionan: en un clon limpio hay que compilarlos antes (`db:semilla` también lo hace, pero
// aquí queda como paso propio y visible).
ejecutar('pnpm build:compartidos');
ejecutar('pnpm db:semilla');
