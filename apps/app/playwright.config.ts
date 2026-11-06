import { defineConfig } from '@playwright/test';

/**
 * Pruebas E2E de la PWA contra la API real y PostgreSQL (criterio 104 de la sección 002, tarea T35).
 * Corren en un viewport de celular (360 × 740, táctil), que es el dispositivo de las personas del
 * restaurante. La E2E de caja (`caja.spec.ts`) y la de facturación electrónica (`facturacion.spec.ts`, 6b) corren
 * además en el proyecto `tablet` (768 × 1024).
 *
 * Requisitos: la base preparada, migrada y con el superadministrador de la semilla
 * (`pnpm db:preparar && pnpm db:migrar && pnpm db:semilla`) y las variables de la API (`DATABASE_URL`,
 * `DATABASE_PLATAFORMA_URL`, `PIN_PEPPER`, `ORIGENES_PERMITIDOS`…). Si ya hay una API en el puerto 3000 y
 * la PWA en el 5173 (por ejemplo con `pnpm dev`), se usan tal cual; si no, Playwright los levanta.
 * Cada corrida crea su propia empresa con nombres únicos: no depende de datos previos ni los ensucia.
 *
 * La E2E de facturación electrónica (historia 006, 6b, T45) necesita además, en el entorno de la API: el worker de
 * envíos de verdad (`WORKER=habilitado` con `DATABASE_COLAS_URL`, pg-boss), `DATABASE_REFERENCIA_URL` y
 * `PADRON_RUC_URL=file://…/apps/api/test/soporte/padron-ejemplo.zip` para cargar el padrón de ejemplo, `CLAVE_CIFRADO` y
 * `API_URL_PUBLICA` (el enlace del PDF). La API de esta prueba es la de `e2e/soporte/api-con-simulador.cjs`: la misma API
 * compilada con un `SimuladorPse` propio cuyas reglas se mueven por un puerto de control (`E2E_PSE_CONTROL_URL`, por
 * defecto http://127.0.0.1:3100). Una API ya levantada con `pnpm dev` no sirve para esa prueba.
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
  projects: [
    { name: 'celular' },
    // La E2E de caja y la de facturación electrónica también corren con todas las personas en tableta (768 × 1024,
    // criterios 118 y 179 de 006). Solo esos archivos: las demás pruebas no se repiten.
    {
      name: 'tablet',
      testMatch: '**/{caja,facturacion}.spec.ts',
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: [
    {
      command: process.env.CI
        ? 'node e2e/soporte/api-con-simulador.cjs'
        : 'pnpm --filter @restaurante/api build && node e2e/soporte/api-con-simulador.cjs',
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
