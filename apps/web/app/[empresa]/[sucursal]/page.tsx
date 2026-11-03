import { notFound } from 'next/navigation';
import { obtenerCarta } from '@/lib/api-servidor';

export const revalidate = 30;

type Props = { params: Promise<{ empresa: string; sucursal: string }> };

/** Esqueleto de T20: la carta completa llega con T22. */
export default async function Carta({ params }: Props) {
  const { empresa, sucursal } = await params;
  const carta = await obtenerCarta(empresa, sucursal);
  if (!carta) notFound();
  return (
    <main>
      <h1>{carta.empresa.nombre}</h1>
      <p>{carta.sucursal.nombre}</p>
    </main>
  );
}
