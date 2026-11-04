import { defineConfig } from 'tsup';

export default defineConfig({
  // `llamados` es una entrada aparte, sin `decimal.js`: la carta web la importa en el navegador
  // (`@restaurante/dominio/llamados`) sin arrastrar las reglas de montos (peso de la primera carga, criterio 88).
  // `caja` también es una entrada aparte (historia 006): la PWA la carga bajo demanda, junto con `decimal.js`, solo en
  // las pantallas de caja y cobro, fuera del paquete inicial.
  entry: { index: 'src/index.ts', llamados: 'src/llamados/index.ts', caja: 'src/caja/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
