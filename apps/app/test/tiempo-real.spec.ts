import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion, borrarTokenDeSesion } from '../src/lib/almacen';
import { avisarCambioDeIdentidad, configurarIdentidad } from '../src/lib/identidad';
import {
  CLAVES_TIEMPO_REAL,
  ESPERAS_DE_RECONEXION_MS,
  PERIODO_DE_SONDEO_MS,
  alRecibirEvento,
  datosDeCocinaListo,
  detenerTiempoReal,
  estadoDeTiempoReal,
  sincronizarTiempoReal,
  useIntervaloDeSondeo,
  usarFabricaDeSocket,
} from '../src/lib/tiempo-real';
import { SocketFalso, socketVigente, socketsAbiertos } from './ayudas-tiempo-real';

// spec: 004-salon-cocina, criterio 97 (tiempo real en la PWA; pruebas no protegidas).

const TOKEN = 'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.uno';
const OTRO_TOKEN =
  'se.11111111-1111-4111-8111-111111111111.33333333-3333-4333-8333-333333333333.dos';
const EQUIPO = 'eq.11111111-1111-4111-8111-111111111111.77777777-7777-4777-8777-777777777777.s';
const S1 = '33333333-3333-4333-8333-333333333333';
const S2 = '44444444-4444-4444-8444-444444444444';
const ORDEN = '99999999-9999-4999-8999-999999999999';

let token: string | null;
let sucursalId: string | null;
let cliente: QueryClient;
let invalidadas: unknown[][];
let opcionesDeInvalidacion: unknown[];

/** Deja que las promesas pendientes (la apertura del socket) terminen. */
const vaciar = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  token = TOKEN;
  sucursalId = S1;
  configurarIdentidad(() => ({ token, sucursalId }));
  guardarTokenDeSesion(TOKEN);
  cliente = new QueryClient();
  invalidadas = [];
  opcionesDeInvalidacion = [];
  vi.spyOn(cliente, 'invalidateQueries').mockImplementation(((
    filtros: { queryKey: unknown[] },
    opciones?: unknown,
  ) => {
    invalidadas.push([...filtros.queryKey]);
    opcionesDeInvalidacion.push(opciones);
    return Promise.resolve();
  }) as never);
});
afterEach(() => {
  detenerTiempoReal();
  vi.useRealTimers();
  vi.restoreAllMocks();
  configurarIdentidad(() => ({ token: null, sucursalId: null }));
});

async function abrir() {
  sincronizarTiempoReal(cliente);
  await vaciar();
  return socketVigente()!;
}

describe('la conexión de la sesión', () => {
  it('sin sesión, o sin sucursal activa, no abre ninguna conexión', async () => {
    token = null;
    sincronizarTiempoReal(cliente);
    await vaciar();
    sucursalId = null;
    token = TOKEN;
    sincronizarTiempoReal(cliente);
    await vaciar();
    expect(socketsAbiertos).toHaveLength(0);
    expect(estadoDeTiempoReal()).toBe('apagado');
  });

  it('abre una sola conexión por sesión, con su token, en /tiempo-real', async () => {
    const socket = await abrir();
    sincronizarTiempoReal(cliente);
    sincronizarTiempoReal(cliente);
    await vaciar();
    expect(socketsAbiertos).toHaveLength(1);
    expect(socket.opciones.path).toBe('/tiempo-real');
    expect(socket.opciones.auth).toEqual({ token: TOKEN });
    expect(socket.opciones.reconnection).toBe(false);
    expect(socket.url).toBe('http://api.prueba');
    expect(estadoDeTiempoReal()).toBe('conectando');
  });

  it('una sesión de PIN manda también el equipo', async () => {
    guardarTokenDeSesion(TOKEN, EQUIPO);
    const socket = await abrir();
    expect(socket.opciones.auth).toEqual({ token: TOKEN, equipo: EQUIPO });
  });

  it('al conectar queda "conectado" y vuelve a pedir lo que hay en pantalla', async () => {
    const socket = await abrir();
    socket.conectar();
    expect(estadoDeTiempoReal()).toBe('conectado');
    expect(invalidadas).toEqual([
      [...CLAVES_TIEMPO_REAL.salon],
      [...CLAVES_TIEMPO_REAL.ordenes],
      [...CLAVES_TIEMPO_REAL.cocina],
      [...CLAVES_TIEMPO_REAL.disponibilidad],
    ]);
    // Si ya hay una lectura en camino, esa sirve: no se cancela para bajar lo mismo dos veces.
    expect(opcionesDeInvalidacion).toEqual(Array(4).fill({ cancelRefetch: false }));
  });

  it('un aviso de cambio sí cancela la lectura en curso, que pudo salir antes del cambio', async () => {
    const socket = await abrir();
    socket.conectar();
    opcionesDeInvalidacion.length = 0;
    socket.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: ORDEN });
    expect(opcionesDeInvalidacion).toEqual([undefined]);
  });

  it('se cierra al salir de la sesión', async () => {
    const socket = await abrir();
    socket.conectar();
    token = null;
    borrarTokenDeSesion();
    avisarCambioDeIdentidad();
    sincronizarTiempoReal(cliente);
    expect(socket.cerrado).toBe(true);
    expect(estadoDeTiempoReal()).toBe('apagado');
  });

  it('al cambiar de usuario cierra la conexión vieja y abre otra con el token nuevo', async () => {
    const viejo = await abrir();
    viejo.conectar();
    token = OTRO_TOKEN;
    guardarTokenDeSesion(OTRO_TOKEN);
    const nuevo = await abrir();
    expect(viejo.cerrado).toBe(true);
    expect(nuevo).not.toBe(viejo);
    expect(nuevo.opciones.auth).toEqual({ token: OTRO_TOKEN });
    // Lo que diga la conexión vieja ya no cuenta.
    invalidadas.length = 0;
    viejo.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: ORDEN });
    expect(invalidadas).toEqual([]);
  });

  it('al cambiar de sucursal abre una conexión nueva con la misma sesión', async () => {
    const primero = await abrir();
    sucursalId = S2;
    const segundo = await abrir();
    expect(primero.cerrado).toBe(true);
    expect(segundo).not.toBe(primero);
    expect(socketsAbiertos).toHaveLength(2);
  });

  it('un socket que termina de abrirse cuando la sesión ya cambió se cierra sin usarse', async () => {
    let terminar: (socket: SocketFalso) => void = () => undefined;
    usarFabricaDeSocket(
      (url, opciones) =>
        new Promise((resolver) => {
          terminar = (socket) => resolver(socket);
          void url;
          void opciones;
        }),
    );
    sincronizarTiempoReal(cliente);
    token = null;
    sincronizarTiempoReal(cliente);
    const tardio = new SocketFalso('http://api.prueba', {
      path: '/tiempo-real',
      auth: { token: TOKEN },
      reconnection: false,
    });
    terminar(tardio);
    await vaciar();
    expect(tardio.cerrado).toBe(true);
    expect(estadoDeTiempoReal()).toBe('apagado');
  });
});

describe('qué consulta vuelve a pedirse con cada evento', () => {
  async function conectada() {
    const socket = await abrir();
    socket.conectar();
    invalidadas.length = 0;
    return socket;
  }

  it('salon.cambio refresca el mapa', async () => {
    const socket = await conectada();
    socket.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: ORDEN });
    expect(invalidadas).toEqual([[...CLAVES_TIEMPO_REAL.salon]]);
  });

  it('orden.cambio refresca esa orden y el mapa (que muestra su total)', async () => {
    const socket = await conectada();
    socket.desdeElServidor('orden.cambio', { ordenId: ORDEN });
    expect(invalidadas).toEqual([['orden', ORDEN], [...CLAVES_TIEMPO_REAL.salon]]);
  });

  it('un orden.cambio mal formado refresca todas las órdenes en vez de ninguna', async () => {
    const socket = await conectada();
    socket.desdeElServidor('orden.cambio', { nada: true });
    expect(invalidadas).toEqual([['orden'], [...CLAVES_TIEMPO_REAL.salon]]);
  });

  it('una comanda nueva refresca la cocina', async () => {
    const socket = await conectada();
    socket.desdeElServidor('cocina.comanda', {});
    expect(invalidadas).toEqual([['cocina']]);
  });

  it('un cambio de línea refresca la cocina y también las cuentas, para que el mozo vea "Preparando"', async () => {
    const socket = await conectada();
    socket.desdeElServidor('cocina.linea', {
      comandaId: S1,
      lineaId: S2,
      estado: 'EN_PREPARACION',
    });
    expect(invalidadas).toEqual([['cocina'], [...CLAVES_TIEMPO_REAL.ordenes]]);
    // Sin datos (mal formado) invalida lo mismo: nunca menos.
    invalidadas.length = 0;
    socket.desdeElServidor('cocina.linea', {});
    expect(invalidadas).toEqual([['cocina'], ['orden']]);
  });

  it('cocina.visto refresca solo la cocina, sin tocar cuentas ni mapa', async () => {
    const socket = await conectada();
    socket.desdeElServidor('cocina.visto', { comandaId: S1 });
    expect(invalidadas).toEqual([['cocina']]);
  });

  it('cocina.visto se reparte a quien oiga eventos, pero el aviso de "Listo" no lo toma como suyo', async () => {
    const socket = await conectada();
    const oyente = vi.fn();
    const dejar = alRecibirEvento(oyente);
    socket.desdeElServidor('cocina.visto', { comandaId: S1 });
    expect(oyente).toHaveBeenCalledWith('cocina.visto', { comandaId: S1 });
    dejar();
  });

  it('cocina.listo refresca la cocina y la orden, y se reparte a quien lo oiga', async () => {
    const socket = await conectada();
    const oyente = vi.fn();
    const dejar = alRecibirEvento(oyente);
    const datos = {
      ordenId: ORDEN,
      itemId: S1,
      lineaId: S2,
      mesas: [{ id: S1, nombre: '4' }],
      nombre: 'Lomo saltado',
      cantidad: 1,
      destinatarios: [S1],
    };
    socket.desdeElServidor('cocina.listo', datos);
    expect(invalidadas).toEqual([['cocina'], ['orden', ORDEN]]);
    expect(oyente).toHaveBeenCalledWith('cocina.listo', datos);
    expect(datosDeCocinaListo(datos)?.nombre).toBe('Lomo saltado');
    expect(datosDeCocinaListo({ ordenId: 'no' })).toBeNull();
    dejar();
    socket.desdeElServidor('cocina.listo', datos);
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it('los eventos de la carta refrescan la disponibilidad', async () => {
    const socket = await conectada();
    socket.desdeElServidor('carta.disponibilidad', {});
    socket.desdeElServidor('carta.actualizada', {});
    expect(invalidadas).toEqual([['disponibilidad'], ['disponibilidad']]);
  });
});

describe('reconexión y sondeo de respaldo', () => {
  beforeEach(() => vi.useFakeTimers());

  it('si se cae, reintenta a 1, 2, 5 y 10 s, y el último se repite', async () => {
    const socket = await abrir();
    socket.conectar();
    socket.desdeElServidor('disconnect');
    expect(estadoDeTiempoReal()).toBe('caido');
    expect(socket.cerrado).toBe(true);

    const esperas = [...ESPERAS_DE_RECONEXION_MS, 10_000];
    expect(esperas).toEqual([1000, 2000, 5000, 10000, 10000]);
    for (const [i, espera] of esperas.entries()) {
      await act(async () => vi.advanceTimersByTimeAsync(espera - 1));
      expect(socketsAbiertos).toHaveLength(i + 1);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(socketsAbiertos).toHaveLength(i + 2);
      // Cada intento falla, así que el siguiente espera más.
      socketVigente()!.desdeElServidor('connect_error', new Error('xhr poll error'));
    }
  });

  it('al reconectar vuelve a empezar la espera desde 1 s y refresca lo que hay en pantalla', async () => {
    const primero = await abrir();
    primero.conectar();
    primero.desdeElServidor('disconnect');
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    const segundo = socketVigente()!;
    segundo.desdeElServidor('connect_error', new Error('x'));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    const tercero = socketVigente()!;
    invalidadas.length = 0;
    tercero.conectar();
    expect(estadoDeTiempoReal()).toBe('conectado');
    expect(invalidadas).toContainEqual([...CLAVES_TIEMPO_REAL.salon]);
    tercero.desdeElServidor('disconnect');
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(socketVigente()).not.toBe(tercero);
  });

  it('si el servidor rechaza la sesión, espera 30 s en vez de insistir', async () => {
    const socket = await abrir();
    socket.desdeElServidor('connect_error', new Error('NO_AUTENTICADO'));
    expect(estadoDeTiempoReal()).toBe('caido');
    await act(async () => vi.advanceTimersByTimeAsync(29_999));
    expect(socketsAbiertos).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(socketsAbiertos).toHaveLength(2);
  });

  it('si no se pudo ni cargar el socket, lo intenta de nuevo', async () => {
    let intentos = 0;
    usarFabricaDeSocket(async (url, opciones) => {
      intentos += 1;
      if (intentos === 1) throw new Error('sin red');
      return new SocketFalso(url, opciones);
    });
    sincronizarTiempoReal(cliente);
    await vaciar();
    expect(estadoDeTiempoReal()).toBe('caido');
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(intentos).toBe(2);
  });

  it('al volver la red reintenta en seguida, sin esperar el turno', async () => {
    const socket = await abrir();
    socket.desdeElServidor('connect_error', new Error('x'));
    expect(socketsAbiertos).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(socketsAbiertos).toHaveLength(2);
  });

  it('detener cancela los reintentos pendientes', async () => {
    const socket = await abrir();
    socket.desdeElServidor('disconnect');
    detenerTiempoReal();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(socketsAbiertos).toHaveLength(1);
  });
});

describe('useIntervaloDeSondeo', () => {
  const envoltura = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: cliente }, children);

  it('sondea cada 30 s mientras no hay conexión abierta y se detiene cuando la hay', async () => {
    const { result } = renderHook(() => useIntervaloDeSondeo(), { wrapper: envoltura });
    expect(PERIODO_DE_SONDEO_MS).toBe(30_000);
    expect(result.current).toBe(30_000);
    const socket = await abrir();
    expect(result.current).toBe(30_000);
    act(() => socket.conectar());
    expect(result.current).toBe(false);
    act(() => socket.desdeElServidor('disconnect'));
    expect(result.current).toBe(30_000);
  });
});
