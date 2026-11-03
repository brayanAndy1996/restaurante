// Deja el entorno local listo con Docker: PostgreSQL 16, roles, base migrada y datos de demostración.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ejecutar = (comando) => execSync(comando, { cwd: raiz, stdio: 'inherit' });

if (!existsSync(join(raiz, '.env'))) {
  copyFileSync(join(raiz, '.env.example'), join(raiz, '.env'));
  console.log('Se creó .env a partir de .env.example');
}

// La carta web (apps/web) lee su propio archivo: Next solo carga los `.env*` de su carpeta, no el de la raíz.
if (!existsSync(join(raiz, 'apps/web/.env.local'))) {
  // Solo aquí se activa `IMAGENES_PERMITIR_IP_LOCAL=1` (desarrollo): en la carta web las fotos salen de la API en
  // `localhost` y Next no las optimiza sin ese permiso. Los `.env.example` la traen comentada para que nadie la
  // copie por accidente a un entorno de producción (la carta web no construye si vale 1 con direcciones públicas).
  const ejemplo = readFileSync(join(raiz, 'apps/web/.env.example'), 'utf8');
  const local = /^# IMAGENES_PERMITIR_IP_LOCAL=1$/m.test(ejemplo)
    ? ejemplo.replace(/^# IMAGENES_PERMITIR_IP_LOCAL=1$/m, 'IMAGENES_PERMITIR_IP_LOCAL=1')
    : `${ejemplo.trimEnd()}\nIMAGENES_PERMITIR_IP_LOCAL=1\n`;
  writeFileSync(join(raiz, 'apps/web/.env.local'), local);
  console.log(
    'Se creó apps/web/.env.local a partir de apps/web/.env.example (con las fotos locales)',
  );
}

ejecutar('docker compose up -d --wait');
ejecutar('pnpm db:preparar');
ejecutar('pnpm db:migrar');
// La semilla usa los paquetes compartidos (`dominio` y `contratos`), que se exportan desde `dist/`
// y no se versionan: en un clon limpio hay que compilarlos antes (`db:semilla` también lo hace, pero
// aquí queda como paso propio y visible).
ejecutar('pnpm build:compartidos');
ejecutar('pnpm db:semilla');
