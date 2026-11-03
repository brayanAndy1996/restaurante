import 'server-only';
import {
  CODIGO_MESA_REGEX,
  SLUG_DE_RUTA_REGEX,
  cartaPublicaSchema,
  empresaPublicaSchema,
  mesaPublicaSchema,
  type CartaPublica,
  type EmpresaPublica,
  type MesaPublica,
} from '@restaurante/contratos';
import { ErrorApi, pedirApi, rutaCarta, rutaMesa, urlApiInterna } from './api';

/**
 * Lecturas de la API pública desde el servidor de Next, con la respuesta validada por los esquemas estrictos de
 * `packages/contratos` (criterio 78). Cada función devuelve `null` si la API responde 404 (o si la dirección tiene
 * una forma imposible, sin molestar a la API): la página muestra entonces "Esta carta no está disponible".
 * Cualquier otro error se lanza y la página de error de Next lo atiende.
 */

/** Segundos que Next guarda la carta (criterio 80). */
export const REVALIDAR_CARTA_SEGUNDOS = 30;

export function etiquetaDeCarta(empresa: string, sucursal: string): string {
  return `carta:${empresa.toLowerCase()}:${sucursal.toLowerCase()}`;
}

async function leer<T>(
  ruta: string,
  esquema: { parse(dato: unknown): T },
  opciones: Parameters<typeof pedirApi>[2],
): Promise<T | null> {
  try {
    const respuesta = await pedirApi(urlApiInterna(), ruta, opciones);
    return esquema.parse(await respuesta.json());
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 404) return null;
    throw error;
  }
}

/** `GET /publico/cartas/:empresa`: la marca y las sucursales publicadas. */
export function obtenerEmpresa(empresa: string): Promise<EmpresaPublica | null> {
  if (!SLUG_DE_RUTA_REGEX.test(empresa)) return Promise.resolve(null);
  return leer(`/publico/cartas/${encodeURIComponent(empresa)}`, empresaPublicaSchema, {
    next: { revalidate: REVALIDAR_CARTA_SEGUNDOS, tags: [`carta:${empresa.toLowerCase()}`] },
  });
}

/** `GET /publico/cartas/:empresa/:sucursal`: la carta, guardada hasta 30 segundos. */
export function obtenerCarta(empresa: string, sucursal: string): Promise<CartaPublica | null> {
  if (!SLUG_DE_RUTA_REGEX.test(empresa) || !SLUG_DE_RUTA_REGEX.test(sucursal)) {
    return Promise.resolve(null);
  }
  return leer(rutaCarta(empresa, sucursal), cartaPublicaSchema, {
    next: {
      revalidate: REVALIDAR_CARTA_SEGUNDOS,
      tags: [etiquetaDeCarta(empresa, sucursal)],
    },
  });
}

/** `GET /publico/mesas/:código`: la mesa de un QR. Nunca se guarda (criterio 80). */
export function obtenerMesa(codigo: string): Promise<MesaPublica | null> {
  if (!CODIGO_MESA_REGEX.test(codigo)) return Promise.resolve(null);
  return leer(rutaMesa(codigo), mesaPublicaSchema, { cache: 'no-store' });
}
