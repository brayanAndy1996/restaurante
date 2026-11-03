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
