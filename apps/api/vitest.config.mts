import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Pruebas de integración de la API: usan PostgreSQL real (DATABASE_ADMIN_URL obligatoria).
// unplugin-swc emite la metadata de decoradores que necesita la inyección de dependencias de Nest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
