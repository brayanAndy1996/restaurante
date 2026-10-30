import {
  eventoCocinaListoDatosSchema,
  eventoOrdenCambioDatosSchema,
  type EventoCocinaListo,
} from '@restaurante/contratos';
import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { equipoDeSesion } from './almacen';
import { API_URL } from './config';
import { identidadActual } from './identidad';

/**
 * Tiempo real de la PWA (criterio 97 de 004): una conexión de Socket.IO por sesión que avisa cuando algo
 * cambió, para que las consultas de TanStack Query se vuelvan a pedir al instante. Nunca lleva datos: los
 * eventos son avisos con ids y la pantalla pide lo nuevo por HTTP (con `ETag`, así que lo que no cambió no
 * se vuelve a bajar).
 *
 * - `socket.io-client` pesa unos 15 kB comprimido: se carga bajo demanda, recién al abrir la sesión, y no
 *   cuenta en el paquete inicial.
 * - Si la conexión se cae, se reconecta con espera creciente (1, 2, 5 y 10 s) y, mientras no hay conexión,
 *   las pantallas con datos en vivo (mapa, orden, cocina) se refrescan cada 30 s con `ETag` y
 *   `X-Actividad: segundo-plano` (`useIntervaloDeSondeo`).
 * - La conexión es de la sesión: se cierra al salir, al cambiar de usuario y al cambiar de sucursal, y
 *   nunca sobrevive a otra persona (se abre con el token de la sesión de ese momento).
 * - La conexión no renueva la inactividad de la sesión (el servidor la trata como segundo plano).
 */

/** Claves de TanStack Query que los eventos invalidan; cada pantalla las usa como prefijo de las suyas. */
export const CLAVES_TIEMPO_REAL = {
  salon: ['salon'] as const,
  /** Todas las órdenes abiertas en pantalla (`['orden', id]` cuelga de aquí). */
  ordenes: ['orden'] as const,
  orden: (ordenId: string) => ['orden', ordenId] as const,
  cocina: ['cocina'] as const,
  /** La disponibilidad de la carta (agotados y menú del día); es la clave de la pantalla de Disponibilidad. */
  disponibilidad: ['disponibilidad'] as const,
  /** El estado de la impresión (`['impresion', 'estado', sucursalId]`): el aviso de todas las pantallas. */
  impresionEstado: ['impresion', 'estado'] as const,
  /** La lista de impresoras de Ajustes, con su estado y sus pendientes (`['impresion', 'impresoras', sucursalId]`). */
  impresoras: ['impresion', 'impresoras'] as const,
} as const;

/** Cada cuánto se refrescan las pantallas en vivo cuando no hay conexión de Socket.IO (criterio 97). */
export const PERIODO_DE_SONDEO_MS = 30_000;

/** Espera entre intentos de reconexión: 1, 2, 5 y 10 s; el último se repite. */
export const ESPERAS_DE_RECONEXION_MS = [1_000, 2_000, 5_000, 10_000] as const;

/** Si el servidor rechazó la sesión (`NO_AUTENTICADO`), insistir cada 10 s no sirve: se espera más. */
const ESPERA_TRAS_RECHAZO_MS = 30_000;

export type EstadoTiempoReal =
  /** No hay sesión con sucursal: no se intenta conectar. */
  | 'apagado'
  /** Abriendo la conexión por primera vez. */
  | 'conectando'
  | 'conectado'
  /** Se cayó o no pudo abrirse: se reintenta y, mientras tanto, las pantallas sondean. */
  | 'caido';

/** Lo mínimo que la PWA usa de un socket de `socket.io-client` (así las pruebas ponen uno de mentira). */
export interface SocketCliente {
  on(evento: string, oyente: (...argumentos: unknown[]) => void): unknown;
  disconnect(): unknown;
}

export interface OpcionesDeSocket {
  path: string;
  auth: { token: string; equipo?: string };
  reconnection: false;
}

export type FabricaDeSocket = (url: string, opciones: OpcionesDeSocket) => Promise<SocketCliente>;

const fabricaReal: FabricaDeSocket = async (url, opciones) => {
  const { io } = await import('socket.io-client');
  return io(url, opciones) as unknown as SocketCliente;
};

let fabrica: FabricaDeSocket = fabricaReal;

/** Solo para pruebas: cambia cómo se abre el socket. Sin argumento, vuelve al real. */
export function usarFabricaDeSocket(nueva?: FabricaDeSocket): void {
  fabrica = nueva ?? fabricaReal;
}

// --- Estado de la conexión ---------------------------------------------------------------------

let estado: EstadoTiempoReal = 'apagado';
const oyentesDeEstado = new Set<() => void>();

function ponerEstado(nuevo: EstadoTiempoReal): void {
  if (nuevo === estado) return;
  estado = nuevo;
  oyentesDeEstado.forEach((oyente) => oyente());
}

export function estadoDeTiempoReal(): EstadoTiempoReal {
  return estado;
}

function suscribirEstado(oyente: () => void): () => void {
  oyentesDeEstado.add(oyente);
  return () => oyentesDeEstado.delete(oyente);
}

export function useEstadoTiempoReal(): EstadoTiempoReal {
  return useSyncExternalStore(suscribirEstado, estadoDeTiempoReal, estadoDeTiempoReal);
}

/**
 * `refetchInterval` de las consultas en vivo: `false` con la conexión abierta (los eventos las
 * actualizan) y 30 s en cualquier otro caso (sondeo de respaldo).
 */
export function useIntervaloDeSondeo(): number | false {
  return useEstadoTiempoReal() === 'conectado' ? false : PERIODO_DE_SONDEO_MS;
}

// --- Eventos -------------------------------------------------------------------------------------

export type NombreDeEvento =
  | 'salon.cambio'
  | 'orden.cambio'
  | 'cocina.comanda'
  | 'cocina.linea'
  | 'cocina.visto'
  | 'cocina.listo'
  | 'carta.disponibilidad'
  | 'carta.actualizada'
  | 'impresion.estado';

const EVENTOS: readonly NombreDeEvento[] = [
  'salon.cambio',
  'orden.cambio',
  'cocina.comanda',
  'cocina.linea',
  'cocina.visto',
  'cocina.listo',
  'carta.disponibilidad',
  'carta.actualizada',
  'impresion.estado',
];

type OyenteDeEvento = (nombre: NombreDeEvento, datos: unknown) => void;
const oyentesDeEvento = new Set<OyenteDeEvento>();

/**
 * Quien necesita más que invalidar (por ejemplo, el aviso de "Listo" del salón) oye los eventos tal como
 * llegan. Devuelve cómo dejar de oír.
 */
export function alRecibirEvento(oyente: OyenteDeEvento): () => void {
  oyentesDeEvento.add(oyente);
  return () => oyentesDeEvento.delete(oyente);
}

/** Los datos de un `cocina.listo` bien formado, o `null`. */
export function datosDeCocinaListo(datos: unknown): EventoCocinaListo['datos'] | null {
  const analizado = eventoCocinaListoDatosSchema.safeParse(datos);
  return analizado.success ? analizado.data : null;
}

function invalidar(
  cliente: QueryClient,
  queryKey: readonly unknown[],
  { respetarLoEnCurso = false }: { respetarLoEnCurso?: boolean } = {},
): void {
  // Un aviso de cambio obliga a pedir de nuevo aunque haya una lectura en curso (pudo salir antes del
  // cambio). Al conectar no: la lectura que ya va en camino sirve y no se baja dos veces.
  void cliente.invalidateQueries(
    { queryKey },
    respetarLoEnCurso ? { cancelRefetch: false } : undefined,
  );
}

/** Qué consultas se vuelven a pedir con cada evento. Un dato mal formado invalida más, nunca menos. */
function alLlegarEvento(cliente: QueryClient, nombre: NombreDeEvento, datos: unknown): void {
  switch (nombre) {
    case 'salon.cambio':
      invalidar(cliente, CLAVES_TIEMPO_REAL.salon);
      break;
    case 'orden.cambio': {
      const analizado = eventoOrdenCambioDatosSchema.safeParse(datos);
      invalidar(
        cliente,
        analizado.success
          ? CLAVES_TIEMPO_REAL.orden(analizado.data.ordenId)
          : CLAVES_TIEMPO_REAL.ordenes,
      );
      // El mapa muestra el total y los comensales de la orden.
      invalidar(cliente, CLAVES_TIEMPO_REAL.salon);
      break;
    }
    case 'cocina.comanda':
      invalidar(cliente, CLAVES_TIEMPO_REAL.cocina);
      break;
    case 'cocina.linea':
      invalidar(cliente, CLAVES_TIEMPO_REAL.cocina);
      // La cuenta del mozo muestra "Preparando" y "2 listos de 3" por ítem; el evento trae la comanda y la
      // línea, no la orden, así que se piden de nuevo las cuentas abiertas (con `ETag`, lo que no cambió no se baja).
      invalidar(cliente, CLAVES_TIEMPO_REAL.ordenes);
      break;
    case 'cocina.visto':
      // Otro KDS marcó "Enterado": la marcha o anulación sale de pendientes aquí también. Sin sonido ni más avisos.
      invalidar(cliente, CLAVES_TIEMPO_REAL.cocina);
      break;
    case 'cocina.listo': {
      invalidar(cliente, CLAVES_TIEMPO_REAL.cocina);
      const listo = datosDeCocinaListo(datos);
      invalidar(
        cliente,
        listo ? CLAVES_TIEMPO_REAL.orden(listo.ordenId) : CLAVES_TIEMPO_REAL.ordenes,
      );
      break;
    }
    case 'carta.disponibilidad':
    case 'carta.actualizada':
      invalidar(cliente, CLAVES_TIEMPO_REAL.disponibilidad);
      break;
    case 'impresion.estado':
      // Cambió el puente o una impresora (criterio 120): el aviso y la lista de Ajustes lo vuelven a pedir.
      invalidar(cliente, CLAVES_TIEMPO_REAL.impresionEstado);
      invalidar(cliente, CLAVES_TIEMPO_REAL.impresoras);
      break;
  }
  oyentesDeEvento.forEach((oyente) => oyente(nombre, datos));
}

/** Al conectar o reconectar pudo haberse perdido algún aviso: se vuelve a pedir todo lo que está en pantalla. */
function invalidarTodo(cliente: QueryClient): void {
  const opciones = { respetarLoEnCurso: true };
  invalidar(cliente, CLAVES_TIEMPO_REAL.salon, opciones);
  invalidar(cliente, CLAVES_TIEMPO_REAL.ordenes, opciones);
  invalidar(cliente, CLAVES_TIEMPO_REAL.cocina, opciones);
  invalidar(cliente, CLAVES_TIEMPO_REAL.disponibilidad, opciones);
  invalidar(cliente, CLAVES_TIEMPO_REAL.impresionEstado, opciones);
}

// --- La conexión de la sesión ----------------------------------------------------------------

let clienteDeConsultas: QueryClient | null = null;
let claveDeSesion: string | null = null;
let socket: SocketCliente | null = null;
let temporizador: ReturnType<typeof setTimeout> | null = null;
/** Cuenta cada apertura y cierre: lo que llega de una conexión vieja se ignora. */
let generacion = 0;
let intentos = 0;

function cerrarSocket(): void {
  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  const viejo = socket;
  socket = null;
  try {
    viejo?.disconnect();
  } catch {
    // Ya estaba cerrado.
  }
}

function programarReintento(g: number, espera?: number): void {
  if (g !== generacion) return;
  ponerEstado('caido');
  const pausa =
    espera ??
    ESPERAS_DE_RECONEXION_MS[Math.min(intentos, ESPERAS_DE_RECONEXION_MS.length - 1)] ??
    10_000;
  intentos += 1;
  if (temporizador !== null) clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    temporizador = null;
    void abrir(g);
  }, pausa);
}

async function abrir(g: number): Promise<void> {
  if (g !== generacion) return;
  const clave = claveDeSesion;
  const cliente = clienteDeConsultas;
  if (clave === null || cliente === null) return;
  if (estado !== 'caido') ponerEstado('conectando');
  const [token = '', equipo = ''] = clave.split('|');

  let nuevo: SocketCliente;
  try {
    nuevo = await fabrica(API_URL, {
      path: '/tiempo-real',
      auth: equipo ? { token, equipo } : { token },
      reconnection: false,
    });
  } catch {
    // No se pudo cargar o abrir (por ejemplo, sin red): las pantallas sondean mientras se reintenta.
    programarReintento(g);
    return;
  }
  if (g !== generacion) {
    nuevo.disconnect();
    return;
  }
  socket = nuevo;

  nuevo.on('connect', () => {
    if (g !== generacion) return;
    intentos = 0;
    ponerEstado('conectado');
    invalidarTodo(cliente);
  });
  const caer = (espera?: number) => {
    if (g !== generacion || socket !== nuevo) return;
    cerrarSocket();
    programarReintento(g, espera);
  };
  nuevo.on('disconnect', () => caer());
  nuevo.on('connect_error', (error) => {
    const rechazada = error instanceof Error && error.message === 'NO_AUTENTICADO';
    caer(rechazada ? ESPERA_TRAS_RECHAZO_MS : undefined);
  });
  for (const nombre of EVENTOS) {
    nuevo.on(nombre, (datos) => {
      if (g !== generacion) return;
      alLlegarEvento(cliente, nombre, datos);
    });
  }
}

/**
 * Cierra la conexión de la sesión y la olvida. Lo que llegue después de una conexión vieja se ignora.
 */
export function detenerTiempoReal(): void {
  generacion += 1;
  claveDeSesion = null;
  intentos = 0;
  cerrarSocket();
  ponerEstado('apagado');
}

/**
 * Alinea la conexión con la sesión de este momento: sin sesión o sin sucursal activa no hay conexión; con
 * una, se abre una (una sola por sesión); si cambió la persona, el equipo o la sucursal, se cierra la
 * anterior y se abre otra con el token nuevo. Se puede llamar las veces que haga falta.
 */
export function sincronizarTiempoReal(cliente: QueryClient): void {
  const { token, sucursalId } = identidadActual();
  const clave = token && sucursalId ? `${token}|${equipoDeSesion() ?? ''}|${sucursalId}` : null;
  clienteDeConsultas = cliente;
  if (clave === claveDeSesion) return;
  detenerTiempoReal();
  if (clave === null) return;
  // La clave guarda también la sucursal (para notar su cambio); el socket solo usa el token y el equipo.
  claveDeSesion = clave;
  void abrir(generacion);
}

if (typeof window !== 'undefined') {
  // Volvió la red: no hace falta esperar al siguiente intento.
  window.addEventListener('online', () => {
    if (estado !== 'caido' || claveDeSesion === null) return;
    intentos = 0;
    cerrarSocket();
    // Cualquier intento que estuviera abriéndose queda viejo: su socket se cierra al llegar.
    generacion += 1;
    void abrir(generacion);
  });
}
