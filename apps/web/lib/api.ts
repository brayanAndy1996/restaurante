/**
 * Cliente mínimo de la API pública (historia 005). Sirve igual en el servidor de Next y en el navegador, y no
 * importa `zod` ni `packages/contratos`: en el navegador solo se usan los tipos, para no sumar peso a la carta.
 * La validación de las respuestas vive en `lib/api-servidor.ts`.
 *
 * - En el servidor, la base es `API_URL_INTERNA` (red interna).
 * - En el navegador, la base es `NEXT_PUBLIC_API_URL` (Next la incrusta al construir, por eso se escribe completa).
 */

export class ErrorApi extends Error {
  /** Estado HTTP; `0` si no hubo respuesta (sin red, tiempo agotado). */
  readonly estado: number;
  /** Código del cuerpo de error de la API (`LLAMADO_PENDIENTE`, `FUERA_DE_HORARIO`…), si lo hay. */
  readonly codigo: string | null;
  /** Solo en `DEMASIADOS_LLAMADOS` y `BLOQUEO_TEMPORAL`: segundos de espera. */
  readonly reintentarEnSegundos: number | null;
  /** Cuerpo de error completo, para quien necesite campos (`campos` de un 422). */
  readonly cuerpo: unknown;

  constructor(
    estado: number,
    mensaje: string,
    detalle: {
      codigo?: string | null;
      reintentarEnSegundos?: number | null;
      cuerpo?: unknown;
    } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.codigo = detalle.codigo ?? null;
    this.reintentarEnSegundos = detalle.reintentarEnSegundos ?? null;
    this.cuerpo = detalle.cuerpo ?? null;
  }

  /** Sin respuesta de la API: conviene reintentar con el mismo `id`. */
  get esDeRed(): boolean {
    return this.estado === 0;
  }
}

function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Base de la API para el servidor de Next. */
export function urlApiInterna(): string {
  const url = process.env.API_URL_INTERNA;
  if (!url) throw new Error('Falta la variable API_URL_INTERNA');
  return sinBarraFinal(url);
}

/** Base de la API para el navegador del cliente. */
export function urlApiPublica(): string {
  // Next reemplaza esta expresión literal al construir; no se puede leer con una clave calculada.
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) throw new Error('Falta la variable NEXT_PUBLIC_API_URL');
  return sinBarraFinal(url);
}

export function rutaCarta(empresa: string, sucursal: string): string {
  return `/publico/cartas/${encodeURIComponent(empresa)}/${encodeURIComponent(sucursal)}`;
}

export function rutaMesa(codigo: string): string {
  return `/publico/mesas/${encodeURIComponent(codigo)}`;
}

export type OpcionesPedido = Omit<RequestInit, 'body'> & {
  /** Se manda como JSON. */
  json?: unknown;
  /** Opciones de caché de Next (`revalidate`, `tags`); se ignoran en el navegador. */
  next?: { revalidate?: number | false; tags?: string[] };
  /** Milisegundos antes de darse por vencido. */
  tiempoMaximoMs?: number;
};

/**
 * Hace la petición y devuelve la respuesta tal cual si es 2xx o 304. Cualquier otro estado, o una falla de red,
 * es un `ErrorApi`: así quien llama distingue "no hay red" (reintentar) de una respuesta final (4xx).
 */
export async function pedirApi(
  base: string,
  ruta: string,
  { json, tiempoMaximoMs = 8000, headers, ...init }: OpcionesPedido = {},
): Promise<Response> {
  const cabeceras = new Headers(headers);
  if (json !== undefined) cabeceras.set('Content-Type', 'application/json');
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${ruta}`, {
      ...init,
      headers: cabeceras,
      body: json === undefined ? undefined : JSON.stringify(json),
      signal: init.signal ?? AbortSignal.timeout(tiempoMaximoMs),
    });
  } catch (causa) {
    throw new ErrorApi(0, 'Sin conexión con el servidor', { cuerpo: causa });
  }
  if (respuesta.ok || respuesta.status === 304) return respuesta;
  throw await errorDeRespuesta(respuesta);
}

async function errorDeRespuesta(respuesta: Response): Promise<ErrorApi> {
  let cuerpo: unknown = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    // Sin cuerpo JSON (por ejemplo un 502 del proxy): queda el estado.
  }
  const datos = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<
    string,
    unknown
  >;
  return new ErrorApi(
    respuesta.status,
    typeof datos.mensaje === 'string' ? datos.mensaje : `La API respondió ${respuesta.status}`,
    {
      codigo: typeof datos.codigo === 'string' ? datos.codigo : null,
      reintentarEnSegundos:
        typeof datos.reintentarEnSegundos === 'number' ? datos.reintentarEnSegundos : null,
      cuerpo,
    },
  );
}
