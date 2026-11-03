// Construye la carta web con `next build`, sin depender del `NODE_ENV` del entorno.
//
// Next solo sabe construir con `NODE_ENV=production` (él mismo lo fija cuando la variable falta). Con
// `NODE_ENV=development` en el entorno —el job `e2e` de la CI y quien lo tenga en su shell, como la API local—
// el prerenderizado de `/_global-error` falla ("Cannot read properties of null (reading 'useContext')"). Por eso
// el script quita la variable del entorno del proceso hijo: Next decide y construye como en producción.
//
//   pnpm --filter @restaurante/web build
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const next = require.resolve('next/dist/bin/next');

const entorno = { ...process.env };
delete entorno.NODE_ENV;

const resultado = spawnSync(process.execPath, [next, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: entorno,
});

process.exit(resultado.status ?? 1);
