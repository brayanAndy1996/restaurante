import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` falla a propósito si lo importa código del navegador; en las pruebas no hay diferencia.
      'server-only': fileURLToPath(new URL('test/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/preparar.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
    css: false,
    env: {
      API_URL_INTERNA: 'http://api.interna',
      NEXT_PUBLIC_API_URL: 'http://api.publica',
    },
  },
});
