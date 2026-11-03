import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Cabecera } from '@/componentes/Cabecera';
import { variablesDeMarca } from '@/componentes/CartaWeb';
import { obtenerEmpresa } from '@/lib/api-servidor';

export const revalidate = 30;

type Props = { params: Promise<{ empresa: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { empresa } = await params;
  const datos = await obtenerEmpresa(empresa);
  if (!datos) return { title: 'Esta carta no está disponible', robots: { index: false } };
  return {
    title: datos.empresa.nombre,
    description: `Elige la sucursal de ${datos.empresa.nombre} para ver su carta.`,
    alternates: { canonical: `/${empresa.toLowerCase()}` },
  };
}

/**
 * Las sucursales publicadas de una empresa (criterio 79). Con una sola, redirige con 307 a su carta: quien abre el
 * enlace de la empresa no tiene nada que elegir.
 */
export default async function Sucursales({ params }: Props) {
  const { empresa } = await params;
  const datos = await obtenerEmpresa(empresa);
  if (!datos) notFound();
  const base = `/${empresa.toLowerCase()}`;
  const [unica, ...otras] = datos.sucursales;
  if (unica && otras.length === 0) redirect(`${base}/${unica.slug}`);
  return (
    <div className="carta" style={variablesDeMarca(datos.empresa.colorPrincipal)}>
      <Cabecera nombre={datos.empresa.nombre} logoUrl={datos.empresa.logoUrl} />
      <main className="pagina">
        {datos.sucursales.length === 0 ? (
          <p>Por ahora no hay cartas publicadas.</p>
        ) : (
          <>
            <h2>Elige tu sucursal</h2>
            <ul className="sucursales">
              {datos.sucursales.map((sucursal) => (
                <li key={sucursal.slug}>
                  <a href={`${base}/${sucursal.slug}`}>
                    <strong>{sucursal.nombre}</strong>
                    <span>{sucursal.direccion}</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
