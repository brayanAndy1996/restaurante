import type { NextConfig } from 'next';
import { resolve } from 'node:path';

/**
 * Carta web y modo mesa (historia 005, entrega 5b). Se publica como servidor independiente
 * (`output: 'standalone'`), con su imagen de Docker.
 */

// Las fotos y el logo salen del almacén de archivos (R2 en producción, la API en desarrollo): el servidor de
// Next las optimiza (WebP o AVIF, al tamaño que se ve) y así el celular descarga lo mínimo.
function patronesDeImagenes(): NonNullable<NextConfig['images']>['remotePatterns'] {
  const base = process.env.ARCHIVOS_URL_PUBLICA ?? 'http://localhost:3000/archivos';
  try {
    const url = new URL(base);
    return [
      {
        protocol: url.protocol === 'https:' ? 'https' : 'http',
        hostname: url.hostname,
        port: url.port,
        pathname: `${url.pathname.replace(/\/$/, '')}/**`,
      },
    ];
  } catch {
    return [];
  }
}

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
  },
  async headers() {
    return [
      {
        // Modo mesa (criterio 80): nunca se guarda, no se indexa y el código no sale en el `Referer` de las
        // fotos. La carta (`/<empresa>/<sucursal>`) lleva su `Cache-Control` en la entrega T22.
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
