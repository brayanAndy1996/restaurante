import { defineConfig } from '@playwright/test';

/**
 * Pruebas E2E de la carta web (Playwright, viewport de celular 360 × 740). Si ya hay una carta en el puerto 3001
 * (por ejemplo con `pnpm --filter @restaurante/web dev`), se usa tal cual; si no, Playwright la construye y la
 * levanta.
 *
 * La carta lee la API pública. Por defecto las pruebas usan una API falsa (`e2e/api-falsa.mjs`, puerto 3100): da
 * datos de ejemplo validados con los esquemas de `packages/contratos` y deja agotar un plato y contar las consultas
 * de disponibilidad, sin PostgreSQL. Con `E2E_API_URL` apuntan a una API real y se saltan las pruebas que necesitan
 * las rutas de control de la falsa. El recorrido de punta a punta con la PWA del Mozo es de la tarea T25.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3001';
const API_FALSA = 'http://localhost:3100';
const API = process.env.E2E_API_URL ?? API_FALSA;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
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
    ...(process.env.E2E_API_URL
      ? []
      : [
          {
            command: 'node e2e/api-falsa.mjs',
            url: `${API_FALSA}/health`,
            reuseExistingServer: true,
            timeout: 30_000,
            stdout: 'ignore' as const,
            stderr: 'pipe' as const,
          },
        ]),
    {
      command: 'pnpm build && pnpm start',
      url: `${WEB}/robots.txt`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        API_URL_INTERNA: API,
        NEXT_PUBLIC_API_URL: API,
        CARTA_WEB_URL: WEB,
        ARCHIVOS_URL_PUBLICA: process.env.ARCHIVOS_URL_PUBLICA ?? `${API}/archivos`,
        // Las fotos de la API falsa salen de `localhost`: Next no optimiza imágenes de una IP local sin este permiso.
        IMAGENES_PERMITIR_IP_LOCAL: '1',
      },
    },
  ],
});
