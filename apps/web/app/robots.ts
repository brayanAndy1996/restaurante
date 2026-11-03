import type { MetadataRoute } from 'next';

/** El modo mesa no se indexa (criterio 80): el código del QR no debe aparecer en un buscador. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/m/' },
  };
}
