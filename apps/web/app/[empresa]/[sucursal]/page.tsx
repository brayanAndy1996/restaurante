import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartaWeb } from '@/componentes/CartaWeb';
import { obtenerCarta } from '@/lib/api-servidor';
import { resumenDeHorario } from '@/lib/horario';

// La carta se arma en el servidor con los datos de la API guardados hasta 30 segundos (criterio 80). El
// `Cache-Control` de la respuesta lo fija `next.config.ts`.
export const revalidate = 30;

type Props = { params: Promise<{ empresa: string; sucursal: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { empresa, sucursal } = await params;
  const carta = await obtenerCarta(empresa, sucursal);
  if (!carta) return { title: 'Esta carta no está disponible', robots: { index: false } };
  const titulo = `${carta.empresa.nombre} · ${carta.sucursal.nombre}`;
  const descripcion = [carta.sucursal.direccion, resumenDeHorario(carta.sucursal.horario)]
    .filter(Boolean)
    .join(' · ');
  const url = `/${empresa.toLowerCase()}/${sucursal.toLowerCase()}`;
  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      locale: 'es_PE',
      siteName: carta.empresa.nombre,
      title: titulo,
      description: descripcion,
      url,
    },
    twitter: { card: 'summary_large_image', title: titulo, description: descripcion },
  };
}

export default async function Carta({ params }: Props) {
  const { empresa, sucursal } = await params;
  const carta = await obtenerCarta(empresa, sucursal);
  if (!carta) notFound();
  return (
    <CartaWeb
      carta={carta}
      empresaSlug={empresa.toLowerCase()}
      sucursalSlug={sucursal.toLowerCase()}
    />
  );
}
