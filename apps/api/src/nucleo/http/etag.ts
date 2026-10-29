import { createHash } from 'node:crypto';

/**
 * `ETag` y `If-None-Match` de las vistas que se leen seguido (la carta de la sucursal, el mapa del salón y la
 * pantalla de cocina): el `ETag` ahorra red, no consultas.
 */

/** JSON canónico: las claves de cada objeto ordenadas, para que el mismo contenido dé siempre el mismo texto. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map((x) => jsonCanonico(x)).join(',')}]`;
  const objeto = valor as Record<string, unknown>;
  const claves = Object.keys(objeto)
    .filter((clave) => objeto[clave] !== undefined)
    .sort();
  return `{${claves.map((c) => `${JSON.stringify(c)}:${jsonCanonico(objeto[c])}`).join(',')}}`;
}

/**
 * `ETag` fuerte de la vista (criterio 49 de 003, criterio 7 de 004): SHA-256 de su JSON canónico, en base64url y entre comillas. El
 * contenido incluye el día operativo, así que cambia al pasar la hora de corte.
 */
export function etagDeVista(vista: unknown): string {
  return `"${createHash('sha256').update(jsonCanonico(vista)).digest('base64url')}"`;
}

/**
 * `true` si `If-None-Match` coincide con el `ETag` actual (RFC 9110, comparación débil para `If-None-Match`):
 * acepta una lista, `W/"…"` y `*`.
 */
export function coincideConEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  const valor = ifNoneMatch.trim();
  if (valor === '*') return true;
  return valor
    .split(',')
    .map((parte) => parte.trim().replace(/^W\//, ''))
    .some((parte) => parte === etag);
}
