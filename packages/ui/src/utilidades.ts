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

/** Copia texto aunque la página no sea un contexto seguro (por ejemplo, en una red local). */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se intenta el método antiguo.
  }
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
