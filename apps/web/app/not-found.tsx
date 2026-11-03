import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Esta carta no está disponible',
  robots: { index: false, follow: false },
};

/** Lo que la API responde con 404 (criterio 79): la página sale con estado HTTP 404. */
export default function NoEncontrada() {
  return (
    <main>
      <h1>Esta carta no está disponible</h1>
      <p>Revisa el enlace o el código QR de tu mesa, o pregunta al personal del local.</p>
    </main>
  );
}
