import type { DisponibilidadPublica } from '@restaurante/contratos';

/** Cada cuánto se consulta la disponibilidad con la página visible (criterio 82). */
export const INTERVALO_DISPONIBILIDAD_MS = 15_000;

/** `true` si lo que llegó parece una respuesta de disponibilidad (no hay `zod` en el navegador). */
export function esDisponibilidad(dato: unknown): dato is DisponibilidadPublica {
  if (typeof dato !== 'object' || dato === null) return false;
  const { vendibles } = dato as { vendibles?: unknown };
  return (
    Array.isArray(vendibles) &&
    vendibles.every(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { id?: unknown }).id === 'string' &&
        Array.isArray((v as { modificadoresNoDisponibles?: unknown }).modificadoresNoDisponibles),
    )
  );
}

/**
 * Oculta (con el atributo `hidden`, sin volver a pintar nada) lo que ya no se puede pedir: los productos que no
 * están en `vendibles`, los modificadores no disponibles de cada uno y las familias que se quedan sin productos
 * (con su enlace de la fila fija). Lo que vuelve a estar disponible se muestra otra vez. Los productos que no
 * estaban en la carta cuando se armó la página no se agregan: eso pide recargar.
 */
export function aplicarDisponibilidad(
  raiz: ParentNode,
  disponibilidad: DisponibilidadPublica,
): void {
  const vendibles = new Map(
    disponibilidad.vendibles.map((v) => [v.id, new Set(v.modificadoresNoDisponibles)]),
  );
  for (const fila of raiz.querySelectorAll<HTMLElement>('[data-producto-id]')) {
    const noDisponibles = vendibles.get(fila.dataset.productoId ?? '');
    fila.hidden = noDisponibles === undefined;
    for (const opcion of fila.querySelectorAll<HTMLElement>('[data-modificador-id]')) {
      opcion.hidden = noDisponibles?.has(opcion.dataset.modificadorId ?? '') ?? false;
    }
  }
  for (const seccion of raiz.querySelectorAll<HTMLElement>('[data-familia-id]')) {
    const conProductos = seccion.querySelector('[data-producto-id]:not([hidden])') !== null;
    seccion.hidden = !conProductos;
    const id = seccion.dataset.familiaId ?? '';
    for (const enlace of raiz.querySelectorAll<HTMLElement>('[data-familia-enlace]')) {
      if (enlace.dataset.familiaEnlace === id) enlace.hidden = !conProductos;
    }
  }
}
