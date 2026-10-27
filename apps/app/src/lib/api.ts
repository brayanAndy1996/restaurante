import { type Ambito, equipoDeSesion, tokenDe } from './almacen';
import { API_URL } from './config';
import { conexion } from './conexion';
import { ErrorApi, errorDeRespuesta } from './errores';

/**
 * Cliente HTTP de la PWA. Toda llamada a la API pasa por aquí (criterio 104):
 *
 * - agrega `Authorization` (sesión de empresa o de superadministrador) y, si se pide, `X-Equipo`;
 * - las consultas automáticas mandan `X-Actividad: segundo-plano` para no renovar la inactividad;
 * - cada escritura lleva una `Idempotency-Key` propia, que se **reutiliza** en los reintentos: repetir
 *   la petición con la misma clave no repite el efecto (RNF-10);
 * - ante un corte de red o un 502/503/504 reintenta con espera creciente, y se despierta al volver
 *   la red; los errores de negocio (4xx) nunca se reintentan;
 * - valida la respuesta con el esquema de `packages/contratos`;
 * - traduce todo fallo a un `ErrorApi` con código y campos.
 */

/** Cualquier objeto con `parse`, como los esquemas de zod de `@restaurante/contratos`. */
export interface Esquema<T> {
  parse(entrada: unknown): T;
}

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OpcionesApi<T> {
  metodo?: Metodo;
  cuerpo?: unknown;
  /** Esquema de la respuesta; sin él, se devuelve el JSON tal cual (o `undefined` si no hay cuerpo). */
  esquema?: Esquema<T>;
  /** Con qué credencial se llama: la de la empresa (por defecto) o la del superadministrador. */
  ambito?: Ambito;
  /** Token de equipo (`eq.…`) para `X-Equipo`. */
  equipo?: string;
  /** Consulta automática: la API la valida pero no renueva la inactividad. */
  segundoPlano?: boolean;
  /**
   * Envía `Idempotency-Key`. `true` genera una clave nueva; un texto usa esa clave (para repetir una
   * escritura lógica desde otra llamada). Solo tiene efecto en escrituras.
   */
  idempotente?: boolean | string;
  /** Cancela la llamada (por ejemplo, TanStack Query al salir de la pantalla). */
  senal?: AbortSignal;
  /** Sin credencial aunque haya una guardada (ingresos). */
  sinToken?: boolean;
  /** Máximo de reintentos; por defecto, la lista completa de esperas (unos 35 segundos). */
  reintentos?: number;
}

/** Espera entre intentos, en milisegundos. El primer intento sale de inmediato. */
const ESPERAS_MS = [600, 1500, 3000, 6000, 10000, 15000] as const;
const TIEMPO_MAXIMO_MS = 15000;
const ESTADOS_REINTENTABLES = new Set([502, 503, 504]);

interface Manejadores {
  /** Un 401 `NO_AUTENTICADO` o `SESION_EXPIRADA` con una credencial guardada: la sesión ya no vale. */
  alSesionInvalida: (ambito: Ambito, codigo: string) => void;
}

let manejadores: Manejadores = { alSesionInvalida: () => undefined };

export function configurarApi(nuevos: Partial<Manejadores>): void {
  manejadores = { ...manejadores, ...nuevos };
}

/** Punto de extensión para las pruebas: la espera entre intentos. */
export const espera = {
  /** Espera `ms` o hasta que vuelva la red, lo que ocurra primero. */
  dormir(ms: number, senal?: AbortSignal): Promise<void> {
    return new Promise((resolver) => {
      const fin = () => {
        clearTimeout(temporizador);
        window.removeEventListener('online', fin);
        senal?.removeEventListener('abort', fin);
        resolver();
      };
      const temporizador = setTimeout(fin, ms);
      window.addEventListener('online', fin, { once: true });
      senal?.addEventListener('abort', fin, { once: true });
    });
  },
};

/** Desfase del reloj de este equipo respecto del servidor (ms), según la cabecera `Date`. */
let desfaseRelojMs = 0;

/** La hora del servidor, para no fiarse de un reloj del celular desajustado. */
export function ahoraDelServidor(): number {
  return Date.now() - desfaseRelojMs;
}

/** UUID v4; `crypto.randomUUID` solo existe en contextos seguros (https o localhost). */
export function nuevaClaveDeIdempotencia(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10)]
    .map((g) => g.join(''))
    .join('-');
}

function leerJson(texto: string): unknown {
  if (!texto) return undefined;
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}

/** Un intento con tiempo máximo; sin `AbortSignal.any`, que Safari solo tiene desde la 17.4. */
async function intentar(url: string, init: RequestInit, senal?: AbortSignal): Promise<Response> {
  const control = new AbortController();
  const temporizador = setTimeout(
    () => control.abort(new DOMException('Tiempo agotado', 'TimeoutError')),
    TIEMPO_MAXIMO_MS,
  );
  const cancelar = () => control.abort(senal?.reason);
  if (senal?.aborted) cancelar();
  senal?.addEventListener('abort', cancelar, { once: true });
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } finally {
    clearTimeout(temporizador);
    senal?.removeEventListener('abort', cancelar);
  }
}

export async function llamar<T = void>(ruta: string, opciones: OpcionesApi<T> = {}): Promise<T> {
  const metodo = opciones.metodo ?? 'GET';
  const ambito = opciones.ambito ?? 'empresa';
  const token = opciones.sinToken ? null : tokenDe(ambito);

  const cabeceras: Record<string, string> = { Accept: 'application/json' };
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  // Una sesión PIN trae el equipo en cada petición (criterio 37); `equipo` explícito manda sobre ella.
  const equipo = opciones.equipo ?? (token && ambito === 'empresa' ? equipoDeSesion() : null);
  if (equipo) cabeceras['X-Equipo'] = equipo;
  if (opciones.segundoPlano) cabeceras['X-Actividad'] = 'segundo-plano';
  if (metodo !== 'GET' && opciones.idempotente) {
    cabeceras['Idempotency-Key'] =
      typeof opciones.idempotente === 'string' ? opciones.idempotente : nuevaClaveDeIdempotencia();
  }
  let cuerpo: string | undefined;
  if (opciones.cuerpo !== undefined) {
    cabeceras['Content-Type'] = 'application/json';
    cuerpo = JSON.stringify(opciones.cuerpo);
  }
  const init: RequestInit = {
    method: metodo,
    headers: cabeceras,
    ...(cuerpo === undefined ? {} : { body: cuerpo }),
  };
  const url = `${API_URL}${ruta}`;

  const maximoReintentos = Math.min(opciones.reintentos ?? ESPERAS_MS.length, ESPERAS_MS.length);
  let reintentada = false;
  let contadoComoPendiente = false;
  try {
    for (let intento = 0; ; intento++) {
      let respuesta: Response | null = null;
      try {
        respuesta = await intentar(url, init, opciones.senal);
      } catch (causa) {
        if (opciones.senal?.aborted) throw causa;
        conexion.fallo();
      }

      if (respuesta) {
        conexion.respondio();
        const fecha = respuesta.headers.get('Date');
        if (fecha && !Number.isNaN(Date.parse(fecha)))
          desfaseRelojMs = Date.now() - Date.parse(fecha);

        if (respuesta.ok) {
          const texto = await respuesta.text();
          const json = leerJson(texto);
          if (!opciones.esquema) return json as T;
          try {
            return opciones.esquema.parse(json);
          } catch {
            throw new ErrorApi({
              estado: respuesta.status,
              codigo: 'RESPUESTA_INVALIDA',
              mensaje: 'Respuesta inválida',
              reintentada,
            });
          }
        }

        const reintentable =
          ESTADOS_REINTENTABLES.has(respuesta.status) ||
          (respuesta.status === 500 && metodo === 'GET');
        if (!reintentable || intento >= maximoReintentos) {
          const error = errorDeRespuesta(
            respuesta.status,
            leerJson(await respuesta.text()),
            reintentada,
          );
          if (
            token &&
            respuesta.status === 401 &&
            (error.codigo === 'NO_AUTENTICADO' || error.codigo === 'SESION_EXPIRADA')
          ) {
            manejadores.alSesionInvalida(ambito, error.codigo);
          }
          throw error;
        }
      } else if (intento >= maximoReintentos) {
        throw new ErrorApi({
          estado: 0,
          codigo: 'SIN_CONEXION',
          mensaje: 'Sin conexión',
          reintentada,
        });
      }

      // Falló por la red o por un 5xx de paso: se espera y se repite con la misma clave.
      void respuesta?.body?.cancel();
      reintentada = true;
      if (metodo !== 'GET' && !contadoComoPendiente) {
        contadoComoPendiente = true;
        conexion.pendienteMas();
      }
      await espera.dormir(
        ESPERAS_MS[intento] ?? ESPERAS_MS[ESPERAS_MS.length - 1] ?? 15000,
        opciones.senal,
      );
      if (opciones.senal?.aborted)
        throw opciones.senal.reason ?? new DOMException('Cancelada', 'AbortError');
    }
  } finally {
    if (contadoComoPendiente) conexion.pendienteMenos();
  }
}

/** Atajos con el mismo comportamiento. */
export const api = {
  get: <T>(
    ruta: string,
    opciones: Omit<OpcionesApi<T>, 'metodo' | 'cuerpo' | 'idempotente'> = {},
  ) => llamar<T>(ruta, { ...opciones, metodo: 'GET' }),
  post: <T = void>(
    ruta: string,
    cuerpo?: unknown,
    opciones: Omit<OpcionesApi<T>, 'metodo' | 'cuerpo'> = {},
  ) => llamar<T>(ruta, { ...opciones, metodo: 'POST', cuerpo }),
  put: <T = void>(
    ruta: string,
    cuerpo?: unknown,
    opciones: Omit<OpcionesApi<T>, 'metodo' | 'cuerpo'> = {},
  ) => llamar<T>(ruta, { ...opciones, metodo: 'PUT', cuerpo }),
  patch: <T = void>(
    ruta: string,
    cuerpo?: unknown,
    opciones: Omit<OpcionesApi<T>, 'metodo' | 'cuerpo'> = {},
  ) => llamar<T>(ruta, { ...opciones, metodo: 'PATCH', cuerpo }),
  delete: <T = void>(ruta: string, opciones: Omit<OpcionesApi<T>, 'metodo' | 'cuerpo'> = {}) =>
    llamar<T>(ruta, { ...opciones, metodo: 'DELETE' }),
};

/** Esquema de una lista a partir del esquema de sus elementos (los de contratos son de un solo objeto). */
export function listaDe<T>(elemento: Esquema<T>): Esquema<T[]> {
  return {
    parse(entrada: unknown): T[] {
      if (!Array.isArray(entrada)) throw new TypeError('Se esperaba una lista');
      return entrada.map((e) => elemento.parse(e));
    },
  };
}
