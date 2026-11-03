import { defineConfig } from '@playwright/test';

/**
 * Pruebas E2E de la carta web (Playwright, viewport de celular 360 × 740). Si ya hay una carta en el puerto 3001
 * (por ejemplo con `pnpm --filter @restaurante/web dev`), se usa tal cual; si no, Playwright la construye y la
 * levanta. Las pruebas del esqueleto no necesitan la API; las de punta a punta (tarea T25) sí.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3001';

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
  webServer: {
    command: 'pnpm build && pnpm start',
    url: `${WEB}/robots.txt`,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      API_URL_INTERNA: process.env.API_URL_INTERNA ?? 'http://localhost:3000',
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
      CARTA_WEB_URL: WEB,
    },
  },
});
