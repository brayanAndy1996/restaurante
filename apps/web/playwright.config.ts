import { defineConfig } from '@playwright/test';

/**
 * Pruebas E2E de la carta web (Playwright, viewport de celular 360 × 740). Dos modos:
 *
 * 1. **Con la API falsa** (por defecto): `e2e/api-falsa.mjs` (puerto 3100) da datos de ejemplo validados con los
 *    esquemas de `packages/contratos` y deja agotar un plato, cortar la red y cambiar el estado de un llamado, sin
 *    PostgreSQL. Corren la carta, el modo mesa, el presupuesto, la compatibilidad y la accesibilidad (axe).
 * 2. **De punta a punta** (`E2E_API_URL=http://localhost:3000`): la API real con PostgreSQL, la PWA del personal y
 *    la carta web, con dos personas a la vez: el cliente en `apps/web` y el Mozo (y Cocina) en `apps/app`
 *    (`e2e/punta-a-punta.spec.ts`, criterio 92). Necesita la base preparada, migrada y con la semilla
 *    (`pnpm db:preparar && pnpm db:migrar && pnpm db:semilla`) y las variables de la API, como la E2E de `apps/app`;
 *    además `ORIGENES_PERMITIDOS` debe incluir la PWA de esta corrida (puerto 5174).
 *
 * Puertos: API 3000, carta web 3001, PWA 5174 (el 5173 queda para `pnpm dev`). Si ya hay algo escuchando en un
 * puerto, se usa tal cual; si no, Playwright lo construye y lo levanta. La carta se sirve con el servidor autónomo
 * de Next (`node .next/standalone/apps/web/server.js`), igual que en producción y en Docker.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3001';
const API_FALSA = 'http://localhost:3100';
const API = process.env.E2E_API_URL ?? API_FALSA;
const DE_PUNTA_A_PUNTA = Boolean(process.env.E2E_API_URL);
const PWA = process.env.E2E_APP_URL ?? 'http://localhost:5174';
// Las ayudas de `apps/app/e2e` (que reusa la prueba de punta a punta) leen la PWA de esta variable.
process.env.E2E_APP_URL = PWA;

const SERVIDOR = {
  reuseExistingServer: true,
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
};

export default defineConfig({
  testDir: './e2e',
  testMatch: DE_PUNTA_A_PUNTA ? '**/punta-a-punta.spec.ts' : '**/*.spec.ts',
  testIgnore: DE_PUNTA_A_PUNTA ? [] : '**/punta-a-punta.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: DE_PUNTA_A_PUNTA ? 180_000 : 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'e2e/resultados',
  use: {
    baseURL: WEB,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'celular' }],
  webServer: [
    ...(DE_PUNTA_A_PUNTA
      ? [
          {
            // La API real. En la CI ya viene compilada.
            command: process.env.CI
              ? 'pnpm --filter @restaurante/api start'
              : 'pnpm --filter @restaurante/api build && pnpm --filter @restaurante/api start',
            url: `${API}/health`,
            timeout: 180_000,
            env: { NODE_ENV: process.env.NODE_ENV ?? 'development' },
            ...SERVIDOR,
          },
          {
            // La PWA del personal, en otro puerto que la de `pnpm dev`.
            command: 'pnpm --filter @restaurante/app exec vite --port 5174 --strictPort',
            url: PWA,
            timeout: 120_000,
            ...SERVIDOR,
          },
        ]
      : [
          {
            command: 'node e2e/api-falsa.mjs',
            url: `${API_FALSA}/health`,
            timeout: 30_000,
            ...SERVIDOR,
          },
        ]),
    {
      command: 'pnpm build && node scripts/servir-autonomo.mjs',
      url: `${WEB}/robots.txt`,
      timeout: 180_000,
      env: {
        // La API y la base de la E2E corren con NODE_ENV=development; la carta se construye y se sirve como en producción.
        NODE_ENV: 'production',
        // El puerto de la carta, no el `PORT` de la API que la E2E de punta a punta trae en el entorno.
        PORT: new URL(WEB).port || '3001',
        API_URL_INTERNA: API,
        NEXT_PUBLIC_API_URL: API,
        CARTA_WEB_URL: WEB,
        // Con la API falsa, siempre la suya (`${API_FALSA}/archivos`): la del entorno (en la CI,
        // `http://localhost:3000/archivos`, la de la API real) no sirve fotos en el 3100. De punta a punta se
        // respeta la del entorno, que es la que usa la API real.
        ARCHIVOS_URL_PUBLICA: DE_PUNTA_A_PUNTA
          ? (process.env.ARCHIVOS_URL_PUBLICA ?? `${API}/archivos`)
          : `${API_FALSA}/archivos`,
        // Las fotos salen de `localhost`: Next no optimiza imágenes de una IP local sin este permiso (solo E2E y
        // desarrollo; en producción no se define).
        IMAGENES_PERMITIR_IP_LOCAL: '1',
      },
      ...SERVIDOR,
    },
  ],
});
