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
    env: { VITE_API_URL: 'http://api.prueba' },
  },
});
