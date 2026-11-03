import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/preparar.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
    css: false,
    // Red de seguridad: con turbo corriendo app, API, web y ui a la vez, las pruebas de jsdom se ponen 3 veces más lentas.
    testTimeout: 15_000,
    env: { VITE_API_URL: 'http://api.prueba' },
  },
});
