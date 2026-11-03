import type { ReactNode } from 'react';

/**
 * Iconos de contorno de un mismo trazo (1.75 px, 24 px), dibujados aquí para no cargar una librería. Siempre
 * acompañan a un texto (salvo la X de cerrar y el + y − de la cantidad, que llevan `aria-label`), así que van
 * ocultos para el lector de pantalla.
 */
const TRAZOS = {
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  mesa: <path d="M3 9h18M5 9v10M19 9v10M3 9l1.2-4h15.6L21 9" />,
  mas: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  alerta: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  campana: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  cuenta: (
    <>
      <path d="M5 2v20l2.3-1.5L9.7 22l2.3-1.5 2.3 1.5 2.4-1.5L19 22V2l-2.3 1.5L14.3 2 12 3.5 9.7 2 7.3 3.5 5 2Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  lapiz: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />,
  basura: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />,
  'sin-red': (
    <path d="M2 8.8a15 15 0 0 1 4-2.4M22 8.8a15 15 0 0 0-9.6-3.7M5 12.9a10 10 0 0 1 3.2-2M19 12.9a10 10 0 0 0-3.6-2.2M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20" />
  ),
} satisfies Record<string, ReactNode>;

export type NombreDeIcono = keyof typeof TRAZOS;

export function Icono({ nombre, pequeno }: { nombre: NombreDeIcono; pequeno?: boolean }) {
  return (
    <svg
      className={pequeno ? 'icono icono--s' : 'icono'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
