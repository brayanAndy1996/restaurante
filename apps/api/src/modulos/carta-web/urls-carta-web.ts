/**
 * Enlaces públicos de la carta web (historia 005, criterios 1 y 7): `CARTA_WEB_URL/<empresa>` y
 * `CARTA_WEB_URL/<empresa>/<sucursal>`. Sin `CARTA_WEB_URL` o sin la dirección que falta, `null`.
 */
export function urlDeEmpresa(base: string | undefined, slugEmpresa: string | null): string | null {
  if (base === undefined || slugEmpresa === null) return null;
  return `${base}/${slugEmpresa}`;
}

export function urlDeSucursal(
  base: string | undefined,
  slugEmpresa: string | null,
  slugSucursal: string | null,
): string | null {
  if (base === undefined || slugEmpresa === null || slugSucursal === null) return null;
  return `${base}/${slugEmpresa}/${slugSucursal}`;
}
