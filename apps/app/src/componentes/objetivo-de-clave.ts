import type { ObjetivoAutorizacion } from '@restaurante/contratos';
import { comoPorcentaje, montoEnSoles } from '../lib/monto';

/**
 * Lo que la ventana de clave necesita saber, además del objetivo, para decirlo con palabras: cómo se llama el ítem
 * y la mesa. El objetivo solo trae ids; los nombres vienen de la cuenta que la persona tiene a la vista.
 */
export interface ContextoDeObjetivo {
  /** Nombre del ítem (descuento de ítem y cortesía). */
  itemNombre?: string;
  /** Unidades vigentes del ítem, para "Lomo saltado × 2" en un descuento de ítem. */
  itemUnidades?: number;
  /** "Mesa 4" o "Mesas 4 y 5". */
  mesa: string;
}

/**
 * Lo que el supervisor lee antes de dar su clave (criterio 40 de 006): "Descuento 10 % · Lomo saltado × 2 · Mesa 4".
 * Sale del mismo `objetivo` que se manda a `POST /autorizaciones`: lo que se muestra y lo que se autoriza no pueden
 * separarse.
 */
export function describirObjetivo(
  objetivo: ObjetivoAutorizacion,
  contexto: ContextoDeObjetivo,
): string {
  if (objetivo.tipo === 'CORTESIA') {
    const unidades = objetivo.cantidad === 1 ? '1 unidad' : `${objetivo.cantidad} unidades`;
    return [
      `Cortesía de ${unidades}`,
      contexto.itemNombre ?? 'un ítem de la cuenta',
      contexto.mesa,
    ].join(' · ');
  }
  const valor =
    objetivo.descuento.tipo === 'PORCENTAJE'
      ? comoPorcentaje(objetivo.descuento.valor)
      : (montoEnSoles(objetivo.descuento.valor) ?? objetivo.descuento.valor);
  const que =
    objetivo.itemId === null
      ? 'Toda la cuenta'
      : `${contexto.itemNombre ?? 'Un ítem de la cuenta'}${
          contexto.itemUnidades !== undefined ? ` × ${contexto.itemUnidades}` : ''
        }`;
  return [`Descuento ${valor}`, que, contexto.mesa].join(' · ');
}

/** `true` si las dos autorizaciones piden exactamente lo mismo (la clave sirve solo para su objetivo). */
export function mismoObjetivo(
  a: ObjetivoAutorizacion | null | undefined,
  b: ObjetivoAutorizacion | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.tipo === 'CORTESIA' && b.tipo === 'CORTESIA') {
    return a.ordenId === b.ordenId && a.itemId === b.itemId && a.cantidad === b.cantidad;
  }
  if (a.tipo === 'DESCUENTO' && b.tipo === 'DESCUENTO') {
    return (
      a.ordenId === b.ordenId &&
      a.itemId === b.itemId &&
      a.descuento.tipo === b.descuento.tipo &&
      a.descuento.valor === b.descuento.valor
    );
  }
  return false;
}
