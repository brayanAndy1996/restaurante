import type { TurnoRespuesta } from '@restaurante/contratos';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor } from './ayudas';
import { sesionDeRol, uuid } from './ayudas-salon';
import { socketVigente } from './ayudas-tiempo-real';

// spec: 006-caja-cobro, criterio 110 en la interfaz (pruebas no protegidas de «Por cobrar»): la lista de cuentas abiertas
// se renueva con los avisos de la orden y del salón, y no ofrece una cuenta vieja al volver a abrirla.

const TURNO: TurnoRespuesta = {
  id: uuid(300),
  caja: { id: uuid(101), nombre: 'Caja 1' },
  responsable: { id: ID.usuario, nombre: 'Marta Pérez' },
  estado: 'ABIERTO',
  abiertoEn: '2026-11-04T23:02:00.000Z',
  diaOperativo: '2026-11-04',
  fondo: '200.00',
  cerradoEn: null,
  cerradoPor: null,
};

const cuenta = (id: string, saldo: string) => ({
  ordenId: id,
  tipo: 'MESA' as const,
  mesas: [{ id: uuid(104), nombre: '4' }],
  mozo: { id: uuid(31), nombre: 'Lucía' },
  abiertaEn: '2026-11-04T23:10:00.000Z',
  estado: 'ABIERTA' as const,
  total: saldo,
  saldo,
  modo: null,
});

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function montar() {
  const estado = { lista: [cuenta(uuid(901), '38.00')] };
  const s = servidor({
    'GET /sesion': () => json(200, sesionDeRol('CAJERO', { modulos: ['SALON', 'CAJA'] })),
    'GET /turnos/mio': () => json(200, TURNO),
    [`GET /turnos/${TURNO.id}/reporte`]: () => json(404, { codigo: 'NO_ENCONTRADO', mensaje: 'x' }),
    'GET /cuentas': () => json(200, estado.lista),
  });
  return Object.assign(s, { estado });
}

const enlaces = () =>
  screen.queryAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/caja/cuentas/'));

describe('«Por cobrar» con los cambios de orden y de salón (criterio 110)', () => {
  it('con la lista abierta, un orden.cambio la vuelve a pedir y la cuenta nueva aparece sin recargar', async () => {
    const s = montar();
    renderApp('/caja?ver=por-cobrar');
    await screen.findByRole('list', { name: 'Cuentas por cobrar' });
    expect(enlaces().map((l) => l.getAttribute('href'))).toEqual([
      `/caja/cuentas/${uuid(901)}/cobrar`,
    ]);

    s.estado.lista = [cuenta(uuid(901), '38.00'), cuenta(uuid(902), '12.00')];
    act(() => socketVigente()?.desdeElServidor('orden.cambio', { ordenId: uuid(902) }));
    await waitFor(() => expect(enlaces()).toHaveLength(2));
  });

  it('un salon.cambio también la renueva', async () => {
    const s = montar();
    renderApp('/caja?ver=por-cobrar');
    await screen.findByRole('list', { name: 'Cuentas por cobrar' });
    s.estado.lista = [];
    act(() =>
      socketVigente()?.desdeElServidor('salon.cambio', { mesaIds: [], ordenId: uuid(901) }),
    );
    expect(await screen.findByText('No hay cuentas abiertas')).toBeVisible();
  });

  it('al volver a abrirla no enseña la cuenta vieja mientras llega la lista nueva', async () => {
    const s = montar();
    renderApp('/caja?ver=por-cobrar');
    await screen.findByRole('list', { name: 'Cuentas por cobrar' });
    // Se pasa a otra vista: «Por cobrar» sale de pantalla. Mientras tanto la cuenta se cobra y la mesa se vuelve a abrir.
    await userEvent.click(screen.getByRole('button', { name: 'Movimientos' }));
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Cuentas por cobrar' })).toBeNull(),
    );
    s.estado.lista = [cuenta(uuid(903), '55.00')];
    act(() => socketVigente()?.desdeElServidor('orden.cambio', { ordenId: uuid(903) }));

    // Respuesta lenta: hasta que llegue, no hay lista que tocar.
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((r) => (soltar = r));
    s.poner('GET /cuentas', async () => {
      await espera;
      return json(200, s.estado.lista);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Por cobrar' }));
    expect(screen.getByLabelText('Cargando las cuentas por cobrar')).toBeInTheDocument();
    expect(enlaces()).toHaveLength(0);
    soltar();
    await waitFor(() =>
      expect(enlaces().map((l) => l.getAttribute('href'))).toEqual([
        `/caja/cuentas/${uuid(903)}/cobrar`,
      ]),
    );
  });
});
