import type { EstadoImpresionRespuesta } from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import {
  SEGUNDOS_SIN_SENAL,
  avisoDeImpresion,
  resumenDeImpresion,
  textoDeCola,
  textosDelAviso,
  unirConY,
} from '../src/modulos/impresion/estado';
import { ID, json, renderApp, servidor, sesionDe, type Manejador } from './ayudas';
import { cocinaDe } from './ayudas-cocina';
import { mesa, salon, sesionDeRol, uuid, zona, Z_SALON } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// spec: 004-salon-cocina, criterios 120 a 122, 138 y 140 (aviso de impresión en todas las pantallas, estado
// en el KDS y en Ajustes; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';
const AHORA = '2026-10-30T17:00:00.000Z';
const segundosAntes = (s: number) => new Date(Date.parse(AHORA) - s * 1000).toISOString();

type Impresora = EstadoImpresionRespuesta['impresoras'][number];

const impresora = (n: number, extra: Partial<Impresora> = {}): Impresora => ({
  id: uuid(100 + n),
  nombre: n === 1 ? 'Cocina' : n === 2 ? 'Barra' : `Impresora ${n}`,
  estado: 'LISTA',
  estadoDesde: segundosAntes(3600),
  pendientes: 0,
  ...extra,
});

/** Un estado de la impresión: el puente (con su señal hace `haceSegundos`) y las impresoras dadas. */
function estadoDe(
  puente: null | { conectado?: boolean; haceSegundos?: number | null },
  impresoras: Impresora[] = [impresora(1)],
): EstadoImpresionRespuesta {
  return {
    ahora: AHORA,
    puente: puente
      ? {
          id: uuid(300),
          nombre: 'Puente de Cocina',
          ultimaSenalEn:
            puente.haceSegundos === null ? null : segundosAntes(puente.haceSegundos ?? 5),
          conectado: puente.conectado ?? true,
        }
      : null,
    impresoras,
  };
}

const sano = () => estadoDe({ conectado: true, haceSegundos: 5 });
const puenteCaido = () =>
  estadoDe({ conectado: false, haceSegundos: 150 }, [impresora(1, { pendientes: 4 })]);
const impresoraCaida = () =>
  estadoDe({ conectado: true, haceSegundos: 5 }, [
    impresora(1, { estado: 'NO_RESPONDE', pendientes: 2 }),
    impresora(2, { pendientes: 7 }),
  ]);

describe('avisoDeImpresion (criterios 121 y 122)', () => {
  it('sin impresoras no hay nada que avisar, tenga o no un puente', () => {
    expect(avisoDeImpresion(estadoDe(null, []), 0)).toBeNull();
    expect(avisoDeImpresion(estadoDe({ conectado: false, haceSegundos: 900 }, []), 0)).toBeNull();
    expect(avisoDeImpresion(estadoDe({ conectado: true, haceSegundos: 3 }, []), 0)).toBeNull();
  });

  it('con impresoras y sin puente avisa, con todos los pendientes', () => {
    const estado = estadoDe(null, [
      impresora(1, { pendientes: 3 }),
      impresora(2, { pendientes: 1 }),
    ]);
    expect(avisoDeImpresion(estado, 0)).toEqual({ tipo: 'sin-puente', pendientes: 4 });
  });

  it('puente sin señal: dice hace cuánto y cuántos tickets esperan', () => {
    expect(avisoDeImpresion(puenteCaido(), 0)).toEqual({
      tipo: 'puente-desconectado',
      sinSenal: 'hace 2 min',
      pendientes: 4,
    });
  });

  it('un puente que nunca mandó señal está desconectado', () => {
    const estado = estadoDe({ conectado: false, haceSegundos: null }, [impresora(1)]);
    expect(avisoDeImpresion(estado, 0)).toEqual({
      tipo: 'puente-desconectado',
      sinSenal: null,
      pendientes: 0,
    });
  });

  it('un puente conectado deja de contar como conectado a los 60 s, con la hora de la API', () => {
    const estado = estadoDe({ conectado: true, haceSegundos: 20 });
    expect(avisoDeImpresion(estado, 0)).toBeNull();
    // 20 s de señal vieja + 40 s desde que llegó la respuesta: justo en el límite todavía vale.
    expect(avisoDeImpresion(estado, (SEGUNDOS_SIN_SENAL - 20) * 1000)).toBeNull();
    // Un segundo más y el puente se da por desconectado, sin esperar a otra consulta.
    expect(avisoDeImpresion(estado, (SEGUNDOS_SIN_SENAL - 20 + 1) * 1000)).toMatchObject({
      tipo: 'puente-desconectado',
      sinSenal: 'hace 1 min',
    });
  });

  it('una impresora que no responde avisa con SUS pendientes, no con los de las demás', () => {
    expect(avisoDeImpresion(impresoraCaida(), 0)).toEqual({
      tipo: 'no-responden',
      nombres: ['Cocina'],
      pendientes: 2,
    });
  });

  it('el puente desconectado manda sobre las impresoras (sin él, ninguna se puede saber)', () => {
    const estado = estadoDe({ conectado: false, haceSegundos: 200 }, [
      impresora(1, { estado: 'NO_RESPONDE', pendientes: 1 }),
      impresora(2, { estado: 'DESCONOCIDO', pendientes: 2 }),
    ]);
    expect(avisoDeImpresion(estado, 0)).toMatchObject({
      tipo: 'puente-desconectado',
      pendientes: 3,
    });
  });

  it('una impresora "sin datos" (Bluetooth) no es un fallo', () => {
    const estado = estadoDe({ conectado: true, haceSegundos: 5 }, [
      impresora(1),
      impresora(2, { estado: 'DESCONOCIDO', pendientes: 6 }),
    ]);
    expect(avisoDeImpresion(estado, 0)).toBeNull();
  });
});

describe('textos del aviso', () => {
  it('usan las frases de la especificación', () => {
    expect(textosDelAviso({ tipo: 'puente-desconectado', sinSenal: null, pendientes: 4 })).toEqual({
      titulo: 'El puente de impresión está desconectado',
      detalle: 'Aún no dio señal. Los tickets quedan en cola (4).',
    });
    expect(textosDelAviso({ tipo: 'no-responden', nombres: ['Cocina'], pendientes: 2 })).toEqual({
      titulo: 'La impresora Cocina no responde',
      detalle: 'Revisa que esté encendida y en la red del local. Los tickets quedan en cola (2).',
    });
  });

  it('varias impresoras: nombres con "y" y verbos en plural', () => {
    const textos = textosDelAviso({
      tipo: 'no-responden',
      nombres: ['Cocina', 'Barra', 'Caja'],
      pendientes: 0,
    });
    expect(textos.titulo).toBe('Las impresoras Cocina, Barra y Caja no responden');
    expect(textos.detalle).toBe(
      'Revisa que estén encendidas y en la red del local. Los tickets nuevos quedan en cola.',
    );
    expect(unirConY(['A', 'B'])).toBe('A y B');
    expect(textoDeCola(0)).toBe('Los tickets nuevos quedan en cola.');
  });

  it('el resumen del KDS: lista, con problemas, sin datos y sin impresoras', () => {
    expect(resumenDeImpresion(sano(), 0)).toEqual({ tono: 'ok', texto: 'Impresión lista' });
    expect(resumenDeImpresion(puenteCaido(), 0)).toEqual({
      tono: 'alerta',
      texto: 'Impresión: puente desconectado · 4 en cola',
    });
    expect(resumenDeImpresion(impresoraCaida(), 0)).toEqual({
      tono: 'alerta',
      texto: 'Impresión: 1 impresora no responde · 2 en cola',
    });
    const bluetooth = estadoDe({ conectado: true, haceSegundos: 5 }, [
      impresora(1, { estado: 'DESCONOCIDO' }),
    ]);
    expect(resumenDeImpresion(bluetooth, 0)?.tono).toBe('neutro');
    expect(resumenDeImpresion(estadoDe(null, []), 0)).toBeNull();
  });
});

// --- Componentes ---------------------------------------------------------------------------------

const administrador = () =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

/** El servidor de la sucursal: `estado` se puede cambiar entre una consulta y otra. */
function conServidor(
  sesion = sesionDeRol('MOZO'),
  inicial: EstadoImpresionRespuesta | null = sano(),
  extra: Record<string, Manejador> = {},
) {
  const actual = { estado: inicial };
  const s = servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /impresion/estado': () =>
      actual.estado
        ? json(200, actual.estado)
        : json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
    'GET /salon': () =>
      json(200, salon([zona(Z_SALON, 'Salón', [mesa(1, '1'), mesa(4, '4', { columna: 2 })])])),
    'GET /cocina/comandas': () => json(200, cocinaDe([])),
    'GET /carta/sucursal': () =>
      json(200, {
        sucursalId: ID.sucursalA,
        diaOperativo: '2026-10-30',
        estaciones: [],
        familias: [],
      }),
    ...extra,
  });
  return Object.assign(s, {
    poner: (estado: EstadoImpresionRespuesta) => {
      actual.estado = estado;
    },
  });
}

const banner = () => screen.queryByText(/puente de impresión|La impresora|Las impresoras/);
const avisoVisible = (texto: string | RegExp) => screen.findByText(texto);

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Aviso de impresión en la app (criterio 122)', () => {
  it('puente desconectado: lo dice en el salón con los tickets que esperan', async () => {
    conServidor(sesionDeRol('MOZO'), puenteCaido());
    renderApp('/salon');
    expect(await avisoVisible('El puente de impresión está desconectado')).toBeVisible();
    expect(
      screen.getByText('Última señal hace 2 min. Los tickets quedan en cola (4).'),
    ).toBeVisible();
  });

  it('impresora que no responde: dice cuál y cuántos tickets esperan en ella', async () => {
    conServidor(sesionDeRol('MOZO'), impresoraCaida());
    renderApp('/salon');
    expect(await avisoVisible('La impresora Cocina no responde')).toBeVisible();
    expect(
      screen.getByText(
        'Revisa que esté encendida y en la red del local. Los tickets quedan en cola (2).',
      ),
    ).toBeVisible();
  });

  it('sale en todas las pantallas de la sucursal: salón, cocina, inicio y ajustes', async () => {
    for (const [ruta, sesion] of [
      ['/salon', sesionDeRol('MOZO')],
      ['/cocina', sesionDeRol('COCINA_BARRA')],
      ['/', administrador()],
      ['/administracion/acceso', administrador()],
    ] as const) {
      conServidor(sesion, puenteCaido(), {
        'GET /sucursales/*/acceso': () => json(500, { codigo: 'ERROR_INTERNO', mensaje: 'x' }),
      });
      const { unmount } = renderApp(ruta);
      expect(await avisoVisible('El puente de impresión está desconectado')).toBeVisible();
      unmount();
    }
  });

  it('no hay puente pero sí impresoras: lo dice', async () => {
    conServidor(sesionDeRol('MOZO'), estadoDe(null, [impresora(1, { pendientes: 3 })]));
    renderApp('/salon');
    expect(await avisoVisible('No hay un puente de impresión vinculado')).toBeVisible();
    expect(screen.getByText('Los tickets quedan en cola (3).')).toBeVisible();
  });

  it('sin impresoras, sin aviso (con o sin puente)', async () => {
    const s = conServidor(sesionDeRol('MOZO'), estadoDe(null, []));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await waitFor(() => expect(s.de('GET', '/impresion/estado')).toHaveLength(1));
    expect(banner()).toBeNull();

    s.poner(estadoDe({ conectado: false, haceSegundos: 900 }, []));
    act(() => socketVigente()?.desdeElServidor('impresion.estado', { sucursalId: ID.sucursalA }));
    await waitFor(() => expect(s.de('GET', '/impresion/estado')).toHaveLength(2));
    expect(banner()).toBeNull();
  });

  it('con el puente conectado y las impresoras listas no aparece nada', async () => {
    const s = conServidor(sesionDeRol('MOZO'), sano());
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await waitFor(() => expect(s.de('GET', '/impresion/estado')).toHaveLength(1));
    expect(banner()).toBeNull();
  });

  it('el evento impresion.estado lo muestra al instante y lo quita al recuperarse', async () => {
    const s = conServidor(sesionDeRol('MOZO'), sano());
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await waitFor(() => expect(s.de('GET', '/impresion/estado')).toHaveLength(1));
    expect(banner()).toBeNull();

    // Se cae una impresora: el servidor avisa y la app lo vuelve a pedir sin esperar los 30 s.
    s.poner(impresoraCaida());
    const socket = socketVigente()!;
    act(() => socket.desdeElServidor('impresion.estado', { sucursalId: ID.sucursalA }));
    expect(await avisoVisible('La impresora Cocina no responde')).toBeVisible();
    expect(s.de('GET', '/impresion/estado')).toHaveLength(2);

    // Vuelve: el aviso desaparece con el siguiente evento.
    s.poner(sano());
    act(() => socket.desdeElServidor('impresion.estado', { sucursalId: ID.sucursalA }));
    await waitFor(() => expect(banner()).toBeNull());
    expect(s.de('GET', '/impresion/estado')).toHaveLength(3);
  });

  it('vuelve a pedir el estado cada 30 s, en segundo plano', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const s = conServidor(sesionDeRol('MOZO'), sano());
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await waitFor(() => expect(s.de('GET', '/impresion/estado')).toHaveLength(1));
    expect(s.de('GET', '/impresion/estado')[0]?.cabeceras.get('X-Actividad')).toBe('segundo-plano');

    s.poner(puenteCaido());
    // A los 15 s se vuelve a evaluar lo que ya se tiene, pero no se pide nada.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(s.de('GET', '/impresion/estado')).toHaveLength(1);
    expect(banner()).toBeNull();
    // A los 30 s sí: la API dice que el puente cayó.
    await act(async () => {
      vi.advanceTimersByTime(14_000);
    });
    expect(s.de('GET', '/impresion/estado')).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(await avisoVisible('El puente de impresión está desconectado')).toBeVisible();
    expect(s.de('GET', '/impresion/estado')).toHaveLength(2);
    expect(s.de('GET', '/impresion/estado')[1]?.cabeceras.get('X-Actividad')).toBe('segundo-plano');

    // Y se recupera en la vuelta siguiente (30 s después).
    s.poner(sano());
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(banner()).toBeNull());
    expect(s.de('GET', '/impresion/estado')).toHaveLength(3);
  });

  it('un puente que deja de latir entre dos consultas se da por desconectado', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    // La consulta de las 17:00:00 dice "conectado, señal hace 50 s"; no llega ninguna más.
    const s = conServidor(sesionDeRol('MOZO'), estadoDe({ conectado: true, haceSegundos: 50 }));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await waitFor(() => expect(s.de('GET', '/impresion/estado')).toHaveLength(1));
    expect(banner()).toBeNull();
    // A los 15 s no hay consulta nueva: el dibujo de cada 15 s calcula con la hora de la API.
    s.poner(null as unknown as EstadoImpresionRespuesta);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(await avisoVisible('El puente de impresión está desconectado')).toBeVisible();
    expect(screen.getByText(/Última señal hace 1 min/)).toBeVisible();
  });

  it('con el estado ilegible no inventa un aviso', async () => {
    const s = conServidor(sesionDeRol('MOZO'), null);
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    await waitFor(() => expect(s.de('GET', '/impresion/estado').length).toBeGreaterThan(0));
    expect(banner()).toBeNull();
  });

  it('el Administrador tiene un atajo a Impresión; los demás roles no', async () => {
    conServidor(administrador(), puenteCaido());
    renderApp('/');
    await avisoVisible('El puente de impresión está desconectado');
    expect(screen.getByRole('link', { name: 'Ver impresión' })).toHaveAttribute(
      'href',
      '/administracion/impresion',
    );
  });

  it('un Mozo solo se entera: sin atajo', async () => {
    conServidor(sesionDeRol('MOZO'), puenteCaido());
    renderApp('/salon');
    await avisoVisible('El puente de impresión está desconectado');
    expect(screen.queryByRole('link', { name: 'Ver impresión' })).toBeNull();
  });
});

describe('Estado de la impresión en el KDS (criterio 138)', () => {
  it('discreto cuando todo va bien', async () => {
    conServidor(sesionDeRol('COCINA_BARRA'), sano());
    renderApp('/cocina');
    expect(await avisoVisible('Impresión lista')).toBeVisible();
    expect(banner()).toBeNull();
  });

  it('con un problema, la etiqueta dice cuál y el banner da el detalle', async () => {
    conServidor(sesionDeRol('COCINA_BARRA'), impresoraCaida());
    renderApp('/cocina');
    expect(await avisoVisible('Impresión: 1 impresora no responde · 2 en cola')).toBeVisible();
    expect(screen.getByText('La impresora Cocina no responde')).toBeVisible();
  });

  it('sin impresoras no dice nada de impresión', async () => {
    const s = conServidor(sesionDeRol('COCINA_BARRA'), estadoDe(null, []));
    renderApp('/cocina');
    await screen.findByText('No hay comandas pendientes');
    await waitFor(() => expect(s.de('GET', '/impresion/estado').length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Impresión/)).toBeNull();
  });
});

describe('Estado en Ajustes › Impresión (criterios 136 y 137)', () => {
  const RAIZ = `/sucursales/${ID.sucursalA}`;
  const listaDeImpresoras = (estado: 'LISTA' | 'NO_RESPONDE') => [
    {
      id: uuid(101),
      sucursalId: ID.sucursalA,
      nombre: 'Cocina',
      conexion: { tipo: 'RED', host: '192.168.1.51', puerto: 9100 },
      anchoMm: 80,
      juegoCaracteres: 'PC850',
      gaveta: false,
      activa: true,
      estado,
      estadoDesde: segundosAntes(10),
      pendientes: estado === 'LISTA' ? 0 : 2,
    },
  ];

  it('la lista y el puente cambian con el evento, sin recargar', async () => {
    let impresoras = listaDeImpresoras('LISTA');
    const s = conServidor(administrador(), sano(), {
      [`GET ${RAIZ}/impresoras`]: () => json(200, impresoras),
      [`GET ${RAIZ}/estaciones-destino`]: () => json(200, []),
      [`GET ${RAIZ}/impresion`]: () => json(200, { impresoraCajaId: null }),
      [`GET ${RAIZ}/puentes`]: () => json(200, []),
      'GET /impresion/trabajos': () => json(200, []),
    });
    renderApp('/administracion/impresion');
    const puente = await screen.findByRole('region', { name: 'Puente de impresión' });
    expect(await within(puente).findByText('Conectado')).toBeVisible();
    expect((await screen.findAllByText('Lista')).length).toBeGreaterThan(0);

    impresoras = listaDeImpresoras('NO_RESPONDE');
    s.poner(puenteCaido());
    act(() => socketVigente()?.desdeElServidor('impresion.estado', { sucursalId: ID.sucursalA }));
    expect(await within(puente).findByText('Sin señal')).toBeVisible();
    expect((await screen.findAllByText('No responde')).length).toBeGreaterThan(0);
    // El banner de arriba lo dice también, pero sin el atajo a la pantalla donde ya está.
    expect(screen.getByText('El puente de impresión está desconectado')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Ver impresión' })).toBeNull();
  });
});
