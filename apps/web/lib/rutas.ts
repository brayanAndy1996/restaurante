/**
 * Las direcciones de la carta se escriben en minúsculas (criterio 79): `/Sabor-Norteno/Miraflores` redirige con 308
 * a `/sabor-norteno/miraflores`. Solo cuentan los dos primeros tramos (la empresa y la sucursal). El código de una
 * mesa (`/m/<código>`) distingue mayúsculas de minúsculas (22 caracteres en base64url): nunca se toca, solo la
 * `m` de adelante.
 */
export function rutaEnMinusculas(ruta: string): string {
  const tramos = ruta.split('/');
  // `/a/b/c` → ['', 'a', 'b', 'c']: la empresa es el tramo 1 y la sucursal, el 2.
  const hasta = tramos[1]?.toLowerCase() === 'm' ? 2 : 3;
  return tramos.map((tramo, i) => (i >= 1 && i < hasta ? tramo.toLowerCase() : tramo)).join('/');
}
