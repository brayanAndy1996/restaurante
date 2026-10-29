import { useEffect, useState, type RefObject } from 'react';

/** Ancho en px del elemento, vigilado mientras la pantalla cambia; 0 hasta que se mide (o sin `ResizeObserver`). */
export function useAnchoDe(referencia: RefObject<HTMLElement | null>): number {
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const elemento = referencia.current;
    if (!elemento) return;
    const medir = () => setAncho(Math.floor(elemento.clientWidth));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    return () => observador.disconnect();
  }, [referencia]);
  return ancho;
}
