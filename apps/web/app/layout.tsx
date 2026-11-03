import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// Fuentes del sistema: la carta no descarga ninguna tipografía (criterio 88).
export const metadata: Metadata = {
  metadataBase: new URL(process.env.CARTA_WEB_URL ?? 'http://localhost:3001'),
  title: { default: 'Carta', template: '%s' },
  // El modo mesa y la carta fijan sus propios metadatos; sin ellos no se indexa nada por accidente.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es-PE">
      <body>{children}</body>
    </html>
  );
}
