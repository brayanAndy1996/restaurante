import { defineConfig } from 'tsup';

export default defineConfig({
  // `llamados` es una entrada aparte, sin `decimal.js`: la carta web la importa en el navegador
  // (`@restaurante/dominio/llamados`) sin arrastrar las reglas de montos (peso de la primera carga, criterio 88).
  entry: { index: 'src/index.ts', llamados: 'src/llamados/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
