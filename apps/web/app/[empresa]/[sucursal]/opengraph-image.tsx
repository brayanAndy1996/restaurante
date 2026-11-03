import { ImageResponse } from 'next/og';
import { colorDeMarcaAccesible } from '@restaurante/dominio';
import { obtenerCarta } from '@/lib/api-servidor';
import { esImagenOptimizable } from '@/lib/imagenes';

// Vista previa al compartir (criterio 83): 1200 × 630 con el logo, el nombre y el color del restaurante; con el
// nombre solo si no hay logo.
export const alt = 'Carta del restaurante';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = { params: Promise<{ empresa: string; sucursal: string }> };

/** El logo como `data:` para que la imagen no dependa de una segunda descarga; solo PNG y JPEG (lo que dibuja satori). */
async function logoComoDatos(url: string | null): Promise<string | null> {
  if (!esImagenOptimizable(url)) return null;
  try {
    const respuesta = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 3600 },
    });
    const tipo = respuesta.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!respuesta.ok || !['image/png', 'image/jpeg'].includes(tipo)) return null;
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    return bytes.length > 600_000 ? null : `data:${tipo};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export default async function ImagenDeLaCarta({ params }: Props) {
  const { empresa, sucursal } = await params;
  const carta = await obtenerCarta(empresa, sucursal);
  const { fondo, texto } = colorDeMarcaAccesible(carta?.empresa.colorPrincipal ?? '#1D4A9E');
  const logo = await logoComoDatos(carta?.empresa.logoUrl ?? null);
  const nombre = carta?.empresa.nombre ?? 'Carta';
  const detalle = carta ? [carta.sucursal.nombre, carta.sucursal.direccion] : [];

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: 80,
        background: fondo,
        color: texto,
      }}
    >
      {logo ? (
        <div
          style={{
            display: 'flex',
            width: 280,
            height: 280,
            flex: 'none',
            marginRight: 64,
            alignItems: 'center',
            justifyContent: 'center',
            background: '#ffffff',
            borderRadius: 40,
          }}
        >
          <img src={logo} alt="" width={240} height={240} style={{ objectFit: 'contain' }} />
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontSize: logo ? 76 : 96, fontWeight: 700, lineHeight: 1.1 }}>{nombre}</div>
        {detalle.map((linea, i) => (
          <div
            key={linea}
            style={{ fontSize: i === 0 ? 48 : 36, marginTop: 20, fontWeight: i === 0 ? 600 : 400 }}
          >
            {linea}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
