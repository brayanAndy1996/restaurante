import { useSyncExternalStore } from 'react';

/** Une nombres de clase ignorando los valores vacíos. */
export function clases(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(' ');
}

/** `true` mientras la consulta de medios coincide (por ejemplo `(min-width: 768px)`). */
export function useCoincide(consulta: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const lista = window.matchMedia(consulta);
      lista.addEventListener('change', avisar);
      return () => lista.removeEventListener('change', avisar);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}

/** Ancho desde el que las listas pasan a tabla y la navegación pasa a riel (DESIGN.md). */
export const CONSULTA_TABLET = '(min-width: 768px)';
