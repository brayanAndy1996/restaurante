import type { SesionRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor } from './ayudas';
import { cocinaDe } from './ayudas-cocina';
import { MOZOS, mesa, salon, sesionDeRol, uuid, zona, Z_SALON } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// spec: 004-salon-cocina, criterios 60 y 98 (avisos de "Listo" en el salón; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

/** Un `cocina.listo` de la línea `n`: el Lomo saltado × 1 de la mesa 4, para los `destinatarios` dados. */
const listo = (destinatarios: string[], extra: Record<string, unknown> = {}) => ({
  ordenId: uuid(904),
  itemId: uuid(1001),
  lineaId: uuid(3001),
  mesas: [{ id: uuid(104), nombre: '4' }],
  nombre: 'Lomo saltado',
  cantidad: 1,
  destinatarios,
  ...extra,
});

function servidorDelSalon(sesion: SesionRespuesta) {
  return servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /salon': () =>
      json(
        200,
        salon([zona(Z_SALON, 'Salón', [mesa(1, '1'), mesa(4, '4', { columna: 2, orden: {} })])]),
      ),
    'GET /cocina/comandas': () => json(200, cocinaDe([])),
    'GET /carta/sucursal': () =>
      json(200, {
        sucursalId: ID.sucursalA,
        diaOperativo: '2026-10-29',
        estaciones: [],
        familias: [],
      }),
  });
}

async function conectado() {
  await waitFor(() => expect(socketVigente()).toBeDefined());
  return socketVigente()!;
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Avisos de "Listo" en el salón (criterios 60 y 98)', () => {
  it('muestra el aviso a quien es destinatario, con la frase de la especificación, y vibra', async () => {
    const vibrar = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate: vibrar });
    servidorDelSalon(sesionDeRol('MOZO'));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();

    const socket = await conectado();
    act(() => socket.desdeElServidor('cocina.listo', listo([ID.usuario, uuid(33)])));
    const lista = await screen.findByRole('region', { name: 'Avisos' });
    expect(within(lista).getByText('Lomo saltado × 1 de la mesa 4 está listo')).toBeInTheDocument();
    expect(vibrar).toHaveBeenCalledTimes(1);
  });

  it('no muestra nada a quien no es destinatario', async () => {
    const vibrar = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, vibrate: vibrar });
    servidorDelSalon(sesionDeRol('MOZO'));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    // El mozo responsable es otra persona: el evento le llega a toda la sucursal, pero no es para él.
    act(() => socket.desdeElServidor('cocina.listo', listo([MOZOS[1]!.id, MOZOS[2]!.id])));
    act(() => socket.desdeElServidor('cocina.listo', listo([])));
    // Un evento mal formado tampoco hace nada.
    act(() => socket.desdeElServidor('cocina.listo', { nombre: 'Lomo saltado' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
    expect(vibrar).not.toHaveBeenCalled();
  });

  it('el aviso se queda hasta que se toca y entonces sale de la lista', async () => {
    servidorDelSalon(sesionDeRol('MOZO'));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() => socket.desdeElServidor('cocina.listo', listo([ID.usuario])));
    act(() =>
      socket.desdeElServidor(
        'cocina.listo',
        listo([ID.usuario], { lineaId: uuid(3002), nombre: 'Ají de gallina', cantidad: 2 }),
      ),
    );
    const lista = await screen.findByRole('region', { name: 'Avisos' });
    // El más reciente va arriba.
    const filas = within(lista).getAllByRole('button', { name: /Toca para quitar el aviso/ });
    expect(filas[0]).toHaveTextContent('Ají de gallina × 2 de la mesa 4 está listo');
    expect(filas[1]).toHaveTextContent('Lomo saltado × 1 de la mesa 4 está listo');

    // Sigue ahí mientras no se toque (por ejemplo, tras otros eventos del salón).
    act(() => socket.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: uuid(904) }));
    expect(
      within(lista).getAllByRole('button', { name: /Toca para quitar el aviso/ }),
    ).toHaveLength(2);

    await userEvent.click(filas[0]!);
    const restantes = within(screen.getByRole('region', { name: 'Avisos' })).getAllByRole(
      'button',
      {
        name: /Toca para quitar el aviso/,
      },
    );
    expect(restantes).toHaveLength(1);
    expect(restantes[0]).toHaveTextContent('Lomo saltado');
    await userEvent.click(restantes[0]!);
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
  });

  it('si la misma línea vuelve a quedar lista, reemplaza el aviso en vez de repetirlo', async () => {
    servidorDelSalon(sesionDeRol('MOZO'));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() => socket.desdeElServidor('cocina.listo', listo([ID.usuario])));
    act(() => socket.desdeElServidor('cocina.listo', listo([ID.usuario])));
    const lista = await screen.findByRole('region', { name: 'Avisos' });
    expect(
      within(lista).getAllByRole('button', { name: /Toca para quitar el aviso/ }),
    ).toHaveLength(1);
  });

  it('con varias mesas unidas, las nombra todas', async () => {
    servidorDelSalon(sesionDeRol('MOZO'));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() =>
      socket.desdeElServidor(
        'cocina.listo',
        listo([ID.usuario], {
          mesas: [
            { id: uuid(104), nombre: 'Mesa 4' },
            { id: uuid(105), nombre: '5' },
            { id: uuid(106), nombre: '6' },
          ],
        }),
      ),
    );
    expect(
      await screen.findByText('Lomo saltado × 1 de las mesas 4, 5 y 6 está listo'),
    ).toBeInTheDocument();
  });

  it('fuera del salón queda un banner que lleva a la lista', async () => {
    servidorDelSalon(sesionDeRol('SUPERVISOR'));
    renderApp('/cocina');
    await screen.findByText('No hay comandas pendientes');
    const socket = await conectado();
    act(() => socket.desdeElServidor('cocina.listo', listo([ID.usuario])));
    const enlace = await screen.findByRole('link', { name: 'Ver avisos' });
    expect(enlace).toHaveAttribute('href', '/salon');
    expect(screen.getByText('Lomo saltado × 1 de la mesa 4 está listo')).toBeInTheDocument();

    await userEvent.click(enlace);
    const lista = await screen.findByRole('region', { name: 'Avisos' });
    expect(within(lista).getByText('Lomo saltado × 1 de la mesa 4 está listo')).toBeInTheDocument();
    // Dentro del salón ya no hace falta el banner.
    expect(screen.queryByRole('link', { name: 'Ver avisos' })).toBeNull();
  });

  it('los avisos son de la persona: otra sesión no los hereda', async () => {
    servidorDelSalon(sesionDeRol('MOZO'));
    const { unmount } = renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    const socket = await conectado();
    act(() => socket.desdeElServidor('cocina.listo', listo([ID.usuario])));
    await screen.findByRole('region', { name: 'Avisos' });
    unmount();

    // Entra otra persona en el mismo equipo.
    servidorDelSalon(sesionDeRol('MOZO', { id: uuid(31), nombre: 'Lucía Salón' }));
    renderApp('/salon');
    await screen.findByRole('grid', { name: 'Mesas de Salón' });
    expect(screen.queryByRole('region', { name: 'Avisos' })).toBeNull();
  });
});
