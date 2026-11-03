import type { CartaSucursalRespuesta, ProductoDeVenta } from '@restaurante/contratos';
import type { Modulo } from '@restaurante/dominio';

/** El módulo del plan que habilita la carta web y el modo mesa (criterio 14, pregunta 8). */
export const MODULO_DE_PEDIDOS_WEB: Modulo = 'PEDIDOS_WEB';

export type FamiliaDeVenta = CartaSucursalRespuesta['familias'][number];

/**
 * Lo que el público puede pedir en este instante (criterio 20, RF-41): los productos `vendible` que se venden solos
 * y tienen precio, y las familias que se quedan con al menos uno. Los modificadores no disponibles siguen en cada
 * producto (la carta los quita al armar la respuesta y la disponibilidad los lista).
 */
export function soloLoQueSePuedePedir(familias: readonly FamiliaDeVenta[]): FamiliaDeVenta[] {
  return familias
    .map((familia) => ({ ...familia, productos: familia.productos.filter(sePuedePedir) }))
    .filter((familia) => familia.productos.length > 0);
}

const sePuedePedir = (p: ProductoDeVenta): boolean =>
  p.vendible && p.seVendeSolo && p.precio !== null;
