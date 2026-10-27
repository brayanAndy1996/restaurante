import { defineConfig } from '@playwright/test';

/**
 * Pruebas E2E de la PWA contra la API real y PostgreSQL (criterio 104 de la sección 002, tarea T35).
 * Corren en un viewport de celular (360 × 740, táctil), que es el dispositivo de las personas del
 * restaurante.
 *
 * Requisitos: la base preparada, migrada y con el superadministrador de la semilla
 * (`pnpm db:preparar && pnpm db:migrar && pnpm db:semilla`) y las variables de la API (`DATABASE_URL`,
 * `DATABASE_PLATAFORMA_URL`, `PIN_PEPPER`, `ORIGENES_PERMITIDOS`…). Si ya hay una API en el puerto 3000 y
 * la PWA en el 5173 (por ejemplo con `pnpm dev`), se usan tal cual; si no, Playwright los levanta.
 * Cada corrida crea su propia empresa con nombres únicos: no depende de datos previos ni los ensucia.
 */
const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173';
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Un solo trabajador: los pasos de cada archivo se suceden en el mismo celular.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'e2e/resultados',
  use: {
    baseURL: APP,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'celular' }],
  webServer: [
    {
      command: process.env.CI
        ? 'pnpm --filter @restaurante/api start'
        : 'pnpm --filter @restaurante/api build && pnpm --filter @restaurante/api start',
      url: `${API}/health`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { NODE_ENV: process.env.NODE_ENV ?? 'development' },
    },
    {
      // Servidor de desarrollo también en la CI: la ventana de clave de supervisor se ejercita con una pantalla
      // de demostración que solo existe en desarrollo (todavía no hay acciones protegidas reales). Con
      // `pnpm dev` ya corriendo se reutiliza.
      command: 'pnpm --filter @restaurante/app dev',
      url: APP,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
