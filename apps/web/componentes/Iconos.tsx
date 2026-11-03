import type { ReactNode } from 'react';

/**
 * Iconos de contorno de un mismo trazo (1.75 px, 24 px), dibujados aquí para no cargar una librería. Siempre
 * acompañan a un texto, así que van ocultos para el lector de pantalla.
 */
const TRAZOS: Record<'reloj' | 'mesa', ReactNode> = {
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  mesa: <path d="M3 9h18M5 9v10M19 9v10M3 9l1.2-4h15.6L21 9" />,
};

export function Icono({ nombre }: { nombre: keyof typeof TRAZOS }) {
  return (
    <svg className="icono" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TRAZOS[nombre]}
    </svg>
  );
}
