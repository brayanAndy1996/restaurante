import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { obtenerMesa } from '@/lib/api-servidor';

// El modo mesa se arma en cada petición (criterio 80).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // Vista previa genérica, sin el código (criterio 83).
  title: 'Tu mesa',
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ codigo: string }> };

/** Esqueleto de T20: la carta con el encabezado de la mesa llega con T22 y el pedido con T24. */
export default async function Mesa({ params }: Props) {
  const { codigo } = await params;
  const mesa = await obtenerMesa(codigo);
  if (!mesa) notFound();
  return (
    <main>
      <h1>{mesa.mesa.nombre}</h1>
    </main>
  );
}
