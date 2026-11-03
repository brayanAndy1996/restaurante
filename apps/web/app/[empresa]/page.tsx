import { notFound } from 'next/navigation';
import { obtenerEmpresa } from '@/lib/api-servidor';

export const revalidate = 30;

type Props = { params: Promise<{ empresa: string }> };

/** Esqueleto de T20: la lista de sucursales (y el 307 si hay una sola) llega con T22. */
export default async function Sucursales({ params }: Props) {
  const { empresa } = await params;
  const datos = await obtenerEmpresa(empresa);
  if (!datos) notFound();
  return (
    <main>
      <h1>{datos.empresa.nombre}</h1>
    </main>
  );
}
