/**
 * Las fotos y el logo salen del almacén de archivos (R2 en producción, la API en desarrollo). El servidor de Next
 * solo optimiza las de ese origen (`ARCHIVOS_URL_PUBLICA`): `next.config.ts` arma de aquí la lista de orígenes
 * permitidos y las páginas preguntan aquí si una foto se puede mostrar, para que una dirección ajena (o un valor
 * mal configurado) deje la fila sin foto en vez de romper la carta.
 */

export interface PatronDeImagen {
  protocol: 'http' | 'https';
  hostname: string;
  port: string;
  pathname: string;
}

export function patronesDeImagenes(
  base: string | undefined = process.env.ARCHIVOS_URL_PUBLICA ?? 'http://localhost:3000/archivos',
): PatronDeImagen[] {
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

/** `true` si `url` es una imagen que el servidor de Next puede optimizar. */
export function esImagenOptimizable(url: string | null | undefined): url is string {
  if (!url) return false;
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return false;
  }
  return patronesDeImagenes().some((patron) => {
    const prefijo = patron.pathname.replace(/\*\*$/, '');
    return (
      `${destino.protocol}` === `${patron.protocol}:` &&
      destino.hostname === patron.hostname &&
      destino.port === patron.port &&
      destino.pathname.startsWith(prefijo) &&
      !destino.pathname.includes('..')
    );
  });
}

const ANFITRIONES_LOCALES = new Set(['localhost', '127.0.0.1']);

/**
 * `IMAGENES_PERMITIR_IP_LOCAL=1` deja que el servidor de Next pida imágenes a una dirección local (desarrollo y
 * E2E: la API sirve las fotos desde `localhost`). En producción abriría a ese servidor a la red interna, así que solo
 * se acepta si las direcciones públicas de la carta (`CARTA_WEB_URL` y `ARCHIVOS_URL_PUBLICA`) son también
 * `localhost` o `127.0.0.1`. Devuelve el problema en palabras, o `null` si todo está bien. `next.config.ts` lo
 * llama al construir y al arrancar, y detiene ambos si hay un problema.
 */
export function problemaConIpLocal(
  entorno: Partial<Record<string, string | undefined>> = process.env,
): string | null {
  if (entorno.IMAGENES_PERMITIR_IP_LOCAL !== '1') return null;
  for (const nombre of ['CARTA_WEB_URL', 'ARCHIVOS_URL_PUBLICA'] as const) {
    const valor = entorno[nombre];
    // Sin valor se usan las direcciones de desarrollo (`localhost`).
    if (!valor) continue;
    let anfitrion: string | null;
    try {
      anfitrion = new URL(valor).hostname;
    } catch {
      anfitrion = null;
    }
    if (anfitrion === null || !ANFITRIONES_LOCALES.has(anfitrion)) {
      return (
        `IMAGENES_PERMITIR_IP_LOCAL=1 solo vale en desarrollo y pruebas, pero ${nombre} (${valor}) no es ` +
        'localhost ni 127.0.0.1. Quita IMAGENES_PERMITIR_IP_LOCAL del entorno de producción.'
      );
    }
  }
  return null;
}
