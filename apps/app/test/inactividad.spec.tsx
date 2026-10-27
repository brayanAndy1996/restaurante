import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion, tokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const pasar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('cierre por inactividad', () => {
  it('avisa 30 segundos antes y cierra la sesión al llegar el plazo si nadie la renovó', async () => {
    const vence = new Date(Date.now() + 60_000).toISOString();
    const s = servidor({
      'GET /sesion': () => json(200, sesionDe({ expiraPorInactividadEn: vence })),
      'DELETE /sesion': () => json(204),
    });
    renderApp('/');
    expect(await screen.findByText('Hola, Marta')).toBeInTheDocument();
    expect(screen.queryByText(/Tu sesión se cerrará en/)).toBeNull();

    await pasar(35_000);
    expect(screen.getByText(/Tu sesión se cerrará en 0:2\d/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir trabajando' })).toBeInTheDocument();

    await pasar(30_000);
    expect(await screen.findByText('Tu sesión se cerró por inactividad')).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
    // La confirmación de fondo no renueva la inactividad.
    const confirmaciones = s
      .de('GET', '/sesion')
      .filter((l) => l.cabeceras.get('X-Actividad') === 'segundo-plano');
    expect(confirmaciones.length).toBeGreaterThan(0);
  });

  it('"Seguir trabajando" renueva la sesión con una consulta que sí cuenta como actividad', async () => {
    let vence = new Date(Date.now() + 60_000).toISOString();
    let primera = true;
    const s = servidor({
      'GET /sesion': ({ cabeceras }) => {
        // La primera lectura es la del arranque; las siguientes que no son de fondo renuevan el plazo.
        if (!primera && cabeceras.get('X-Actividad') !== 'segundo-plano') {
          vence = new Date(Date.now() + 30 * 60_000).toISOString();
        }
        primera = false;
        return json(200, sesionDe({ expiraPorInactividadEn: vence }));
      },
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await pasar(40_000);
    const boton = screen.getByRole('button', { name: 'Seguir trabajando' });
    await act(async () => {
      boton.click();
    });
    await pasar(1500);
    expect(screen.queryByText(/Tu sesión se cerrará en/)).toBeNull();
    expect(tokenDeSesion()).toBe(TOKEN);
    const renovaciones = s
      .de('GET', '/sesion')
      .filter((l) => l.cabeceras.get('X-Actividad') !== 'segundo-plano');
    expect(renovaciones.length).toBeGreaterThanOrEqual(2);
  });

  it('si otra pestaña o llamada renovó la sesión, no se cierra al llegar el plazo local', async () => {
    let vence = new Date(Date.now() + 40_000).toISOString();
    servidor({ 'GET /sesion': () => json(200, sesionDe({ expiraPorInactividadEn: vence })) });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    vence = new Date(Date.now() + 30 * 60_000).toISOString(); // el servidor ya la renovó
    await pasar(45_000);
    expect(tokenDeSesion()).toBe(TOKEN);
    expect(screen.getByText('Hola, Marta')).toBeInTheDocument();
  });

  it('las consultas de fondo mandan X-Actividad: segundo-plano', async () => {
    const s = servidor({
      'GET /sesion': () =>
        json(
          200,
          sesionDe({ expiraPorInactividadEn: new Date(Date.now() + 10 * 60_000).toISOString() }),
        ),
    });
    renderApp('/');
    await screen.findByText('Hola, Marta');
    await pasar(61_000);
    const de_fondo = s
      .de('GET', '/sesion')
      .filter((l) => l.cabeceras.get('X-Actividad') === 'segundo-plano');
    expect(de_fondo.length).toBeGreaterThanOrEqual(1);
  });
});
