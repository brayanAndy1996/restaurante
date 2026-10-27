import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/preparar.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
    css: false,
  },
});
