import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// PWA: el manifiesto y la caché de los archivos estáticos (nunca de la API: los datos siempre vienen
// de la red, no hay modo sin conexión). La fuente latina se precarga; el latino extendido se descarga
// solo si un texto lo necesita.
export default defineConfig({
  // Lee el `.env` de la raíz; Vite solo expone al navegador las variables que empiezan con VITE_.
  envDir: '../..',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icono.svg', 'icono-180.png'],
      manifest: {
        name: 'Restaurante',
        short_name: 'Restaurante',
        description: 'Aplicación del personal del restaurante.',
        lang: 'es-PE',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f7f9',
        theme_color: '#1d4a9e',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icono-512-enmascarable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/*latin-ext*'],
        navigateFallback: '/index.html',
        // Las llamadas a la API nunca pasan por la caché del service worker.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 5173, strictPort: true, host: true },
  build: { target: 'es2022', sourcemap: false },
});
