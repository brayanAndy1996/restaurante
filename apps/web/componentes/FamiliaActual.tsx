'use client';

import { useEffect } from 'react';

/**
 * Isla de la fila de familias (solo mejora lo que ya funciona sin JavaScript): marca con `aria-current` la familia
 * que está en pantalla y la centra en la fila que se desliza. No dibuja nada.
 */
export function FamiliaActual() {
  useEffect(() => {
    const fila = document.querySelector<HTMLElement>('.familias ul');
    if (!fila) return;
    const carril: HTMLElement = fila;
    const enlaces = [...carril.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    let actual: HTMLAnchorElement | null = null;
    let pendiente = 0;

    function marcar(): void {
      pendiente = 0;
      // Un título queda "en pantalla" al pasar bajo la fila fija (65 px) y un poco de aire.
      const linea = 96;
      const alFinal =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let elegido: HTMLAnchorElement | null = null;
      for (const enlace of enlaces) {
        const seccion = document.getElementById(enlace.hash.slice(1));
        if (!seccion || seccion.hidden) continue;
        elegido ??= enlace;
        // Al final de la página la última sección nunca llega a la línea: se da por vista.
        if (alFinal || seccion.getBoundingClientRect().top <= linea) elegido = enlace;
      }
      if (!elegido || elegido === actual) return;
      actual?.removeAttribute('aria-current');
      elegido.setAttribute('aria-current', 'true');
      actual = elegido;
      const centro = elegido.offsetLeft - (carril.clientWidth - elegido.offsetWidth) / 2;
      carril.scrollLeft = Math.max(0, centro);
    }

    function alDesplazar(): void {
      if (pendiente === 0) pendiente = requestAnimationFrame(marcar);
    }

    marcar();
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => {
      window.removeEventListener('scroll', alDesplazar);
      cancelAnimationFrame(pendiente);
    };
  }, []);

  return null;
}
