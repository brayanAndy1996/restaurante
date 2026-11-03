import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CartaWeb, etiquetaDeMesa } from '@/componentes/CartaWeb';
import { Mesa } from '@/componentes/mesa/Mesa';
import { obtenerCarta, obtenerMesa } from '@/lib/api-servidor';
import type { ProductoMesa } from '@/lib/pedido';

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
 * `/m/<código>`: la carta de la sucursal con el encabezado de la mesa y, en la barra fija de abajo, el pedido,
 * "Llamar al mozo" y "Pedir la cuenta" (la isla `Mesa`, que solo se carga aquí). A la isla solo viaja lo que la hoja
 * del producto necesita: nombre, descripción, foto, precio y grupos.
 */
export default async function PaginaDeMesa({ params }: Props) {
  const { codigo } = await params;
  const mesa = await obtenerMesa(codigo);
  if (!mesa) notFound();
  const carta = await obtenerCarta(mesa.carta.empresaSlug, mesa.carta.sucursalSlug);
  if (!carta) notFound();
  const productos: ProductoMesa[] = carta.familias.flatMap((familia) =>
    familia.productos.map(({ id, nombre, descripcion, fotoUrl, precio, grupos }) => ({
      id,
      nombre,
      descripcion,
      fotoUrl,
      precio,
      grupos,
    })),
  );
  return (
    <CartaWeb
      carta={carta}
      empresaSlug={mesa.carta.empresaSlug}
      sucursalSlug={mesa.carta.sucursalSlug}
      mesa={mesa.mesa.nombre}
      barra={
        <Mesa
          codigo={codigo}
          mesa={etiquetaDeMesa(mesa.mesa.nombre)}
          productos={productos}
          aceptaLlamados={mesa.aceptaLlamados}
          llamadoPendiente={mesa.llamadoPendiente}
        />
      }
    />
  );
}
