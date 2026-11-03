import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { patronesDeImagenes } from './lib/imagenes';

/**
 * Carta web y modo mesa (historia 005, entrega 5b). Se publica como servidor independiente
 * (`output: 'standalone'`), con su imagen de Docker.
 */

// Las fotos y el logo salen del almacén de archivos (R2 en producción, la API en desarrollo): el servidor de
// Next las optimiza (WebP o AVIF, al tamaño que se ve) y así el celular descarga lo mínimo. El origen permitido
// se arma en `lib/imagenes.ts`, que también usan las páginas para no pedir una foto de otro lado.

/** `Cache-Control` de la carta (criterio 80). */
export const CACHE_CONTROL_CARTA = 'public, s-maxage=30, stale-while-revalidate=60';

const config: NextConfig = {
  output: 'standalone',
  // Monorepo: la traza de la imagen autónoma parte de la raíz del repositorio para incluir los paquetes
  // compartidos (`packages/dominio` y `packages/contratos`). Los scripts corren siempre desde `apps/web`.
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: patronesDeImagenes(),
    formats: ['image/avif', 'image/webp'],
    // Solo se pide el logo (48 px) y la foto de la lista (96 px), cada una al 1x y al 2x: nada más grande. Así el
    // `srcset` de cada foto tiene dos entradas y no catorce, y el HTML de una carta de 150 productos pesa poco.
    imageSizes: [48, 96, 192],
    deviceSizes: [640],
    // Solo para desarrollo y pruebas, cuando los archivos salen de la API en `localhost`: Next no optimiza imágenes
    // que resuelven a una IP local salvo que se le diga. En producción el almacén es público y esto no se usa.
    dangerouslyAllowLocalIP: process.env.IMAGENES_PERMITIR_IP_LOCAL === '1',
  },
  async headers() {
    return [
      {
        // La carta (criterio 80): el CDN la guarda 30 s y la sirve hasta 60 s más mientras la renueva. Solo las
        // direcciones `/<empresa>` y `/<empresa>/<sucursal>`: nunca `/m/…`, `/_next/…` ni los archivos con extensión.
        source: '/:empresa((?!m$)[a-zA-Z0-9-]+)',
        headers: [{ key: 'Cache-Control', value: CACHE_CONTROL_CARTA }],
      },
      {
        source: '/:empresa((?!m$)[a-zA-Z0-9-]+)/:sucursal([a-zA-Z0-9-]+)',
        headers: [{ key: 'Cache-Control', value: CACHE_CONTROL_CARTA }],
      },
      {
        // Modo mesa (criterio 80): nunca se guarda, no se indexa y el código no sale en el `Referer` de las
        // fotos.
        source: '/m/:codigo*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default config;
