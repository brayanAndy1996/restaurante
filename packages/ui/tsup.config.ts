import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
  // Copia con Node y no con `cp`/`mkdir -p`, que no existen en la terminal de Windows.
  onSuccess: async () => {
    mkdirSync(join('dist', 'estilos'), { recursive: true });
    for (const archivo of readdirSync(join('src', 'estilos'))) {
      if (archivo.endsWith('.css')) {
        copyFileSync(join('src', 'estilos', archivo), join('dist', 'estilos', archivo));
      }
    }
  },
});
