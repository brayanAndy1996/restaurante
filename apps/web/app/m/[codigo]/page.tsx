import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartaWeb } from '@/componentes/CartaWeb';
import { obtenerCarta, obtenerMesa } from '@/lib/api-servidor';

// El modo mesa se arma en cada petición (criterio 80); sus cabeceras (`private, no-store`, `noindex`,
// `Referrer-Policy: no-referrer`) las fija `next.config.ts`.
export const dynamic = 'force-dynamic';

// Vista previa genérica, sin el código ni el nombre de la mesa (criterio 83).
export const metadata: Metadata = {
  title: 'Tu mesa',
  description: 'La carta de tu mesa: mira los platos y avisa al mozo.',
  robots: { index: false, follow: false },
  openGraph: { type: 'website', title: 'Carta de tu mesa' },
};

type Props = { params: Promise<{ codigo: string }> };

/**
 * `/m/<código>`: la carta de la sucursal con el encabezado de la mesa. El pedido, "Llamar al mozo" y "Pedir la
 * cuenta" (la barra fija de abajo) son de la tarea T24; `CartaWeb` ya tiene su lugar (`barra`).
 */
export default async function Mesa({ params }: Props) {
  const { codigo } = await params;
  const mesa = await obtenerMesa(codigo);
  if (!mesa) notFound();
  const carta = await obtenerCarta(mesa.carta.empresaSlug, mesa.carta.sucursalSlug);
  if (!carta) notFound();
  return (
    <CartaWeb
      carta={carta}
      empresaSlug={mesa.carta.empresaSlug}
      sucursalSlug={mesa.carta.sucursalSlug}
      mesa={mesa.mesa.nombre}
    />
  );
}
