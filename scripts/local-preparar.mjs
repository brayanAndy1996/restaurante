// Deja el entorno local listo con Docker: PostgreSQL 16, roles y base migrada.
// (La semilla de demostración se agrega en la tarea T17.)
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
