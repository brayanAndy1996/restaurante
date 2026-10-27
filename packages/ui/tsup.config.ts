import { defineConfig } from 'tsup';

// Verifica que el paquete se compila solo y deja una copia en `dist/` (JS, tipos y estilos) para
// quien no use el código fuente directo. La PWA lo consume desde `src/` (paquete interno).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  external: ['react', 'react-dom', 'lucide-react', '@restaurante/dominio'],
  loader: { '.css': 'copy' },
  onSuccess: 'mkdir -p dist/estilos && cp src/estilos/*.css dist/estilos/',
});
