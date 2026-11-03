import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { colorDeMarcaAccesible } from '@restaurante/dominio';
import { obtenerCarta } from '@/lib/api-servidor';
import { esImagenOptimizable } from '@/lib/imagenes';

// Vista previa al compartir (criterio 83): 1200 × 630 con el logo, el nombre y el color del restaurante; con el
// nombre solo si no hay logo.
export const alt = 'Carta del restaurante';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Props = { params: Promise<{ empresa: string; sucursal: string }> };

/** Lo más que se lee de un logo para la vista previa. */
const MAXIMO_LOGO_BYTES = 600_000;

/** Lee el cuerpo hasta `maximo` bytes; `null` si es más grande (se corta sin bajarlo entero). */
async function leerAcotado(respuesta: Response, maximo: number): Promise<Buffer | null> {
  const declarado = Number(respuesta.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > maximo) return null;
  if (!respuesta.body) return null;
  const trozos: Uint8Array[] = [];
  let total = 0;
  const lector = respuesta.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos);
}

/** El logo como `data:` para que la imagen no dependa de una segunda descarga; solo PNG y JPEG (lo que dibuja satori). */
async function logoComoDatos(url: string | null): Promise<string | null> {
  if (!esImagenOptimizable(url)) return null;
  try {
    const respuesta = await fetch(url, {
      signal: AbortSignal.timeout(3000),
      // El logo sale del almacén de archivos: una redirección (a otro origen, a la red interna) no se sigue.
      redirect: 'error',
      next: { revalidate: 3600 },
    });
    const tipo = respuesta.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!respuesta.ok || !['image/png', 'image/jpeg'].includes(tipo)) return null;
    const bytes = await leerAcotado(respuesta, MAXIMO_LOGO_BYTES);
    return bytes ? `data:${tipo};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  }
}

export default async function ImagenDeLaCarta({ params }: Props) {
  const { empresa, sucursal } = await params;
  const carta = await obtenerCarta(empresa, sucursal);
  // Una carta que no existe no tiene vista previa: 404, no una imagen genérica que alguien podría compartir.
  if (!carta) notFound();
  const { fondo, texto } = colorDeMarcaAccesible(carta.empresa.colorPrincipal);
  const logo = await logoComoDatos(carta.empresa.logoUrl);
  const nombre = carta.empresa.nombre;
  const detalle = [
    { clave: 'sucursal', texto: carta.sucursal.nombre },
    { clave: 'direccion', texto: carta.sucursal.direccion },
  ].filter((linea): linea is { clave: string; texto: string } => Boolean(linea.texto));

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
            key={linea.clave}
            style={{ fontSize: i === 0 ? 48 : 36, marginTop: 20, fontWeight: i === 0 ? 600 : 400 }}
          >
            {linea.texto}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
