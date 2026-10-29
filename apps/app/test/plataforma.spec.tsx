import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarSesionDePlataforma, soporteEnCurso, tokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN_SA = 'sa.66666666-6666-4666-8666-666666666666.secreto';
const TOKEN_SOPORTE =
  'se.11111111-1111-4111-8111-111111111111.77777777-7777-4777-8777-777777777777.secreto';

const empresas = [
  {
    id: ID.empresa,
    nombre: 'Inversiones Sol del Norte',
    creadoEn: '2026-10-01T15:00:00.000Z',
    sucursales: [
      { id: ID.sucursalA, nombre: 'Miraflores', estadoSuscripcion: 'ACTIVA' },
      { id: ID.sucursalB, nombre: 'Surco', estadoSuscripcion: 'EN_GRACIA' },
    ],
  },
  {
    id: ID.otro,
    nombre: 'Cevichería La Marea',
    creadoEn: '2026-10-05T15:00:00.000Z',
    sucursales: [{ id: ID.superadmin, nombre: 'Barranco', estadoSuscripcion: 'SUSPENDIDA' }],
  },
];

const sesionSoporte = () =>
  sesionDe({
    tipo: 'SOPORTE',
    usuario: null,
    superadministrador: { id: ID.superadmin, nombre: 'Ana Torres' },
    sucursal: null,
  });

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ingreso del superadministrador', () => {
  it('es una pantalla propia y guarda la sesión de plataforma aparte de la de empresa', async () => {
    const s = servidor({
      'POST /plataforma/sesiones': () =>
        json(201, {
          token: TOKEN_SA,
          superadministrador: { id: ID.superadmin, nombre: 'Ana Torres' },
        }),
      'GET /plataforma/empresas': () => json(200, empresas),
    });
    renderApp('/plataforma/ingreso');
    await userEvent.type(screen.getByLabelText('Usuario'), 'ana');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Clave-de-ana-1');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeInTheDocument();
    expect(s.de('GET', '/plataforma/empresas')[0]?.cabeceras.get('Authorization')).toBe(
      `Bearer ${TOKEN_SA}`,
    );
    expect(tokenDeSesion()).toBeNull();
    expect(sessionStorage.getItem('restaurante.plataforma')).toContain(TOKEN_SA);
  });

  it('con credenciales incorrectas dice lo mismo que el ingreso de empresa', async () => {
    servidor({
      'POST /plataforma/sesiones': () =>
        json(401, { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'x' }),
    });
    renderApp('/plataforma/ingreso');
    await userEvent.type(screen.getByLabelText('Usuario'), 'ana');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu usuario o contraseña no son correctos',
    );
  });

  it('el panel exige la sesión: sin ella, lleva al ingreso de plataforma', async () => {
    servidor({});
    renderApp('/plataforma');
    expect(
      await screen.findByRole('heading', { name: 'Ingreso de plataforma' }),
    ).toBeInTheDocument();
  });

  it('un token de empresa no abre el panel', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SOPORTE }));
    servidor({ 'GET /sesion': () => json(200, sesionDe()) });
    renderApp('/plataforma');
    expect(
      await screen.findByRole('heading', { name: 'Ingreso de plataforma' }),
    ).toBeInTheDocument();
  });
});

describe('empresas y soporte', () => {
  beforeEach(() => {
    guardarSesionDePlataforma({
      token: TOKEN_SA,
      superadministrador: { id: ID.superadmin, nombre: 'Ana Torres' },
    });
  });

  it('lista las empresas con el estado de suscripción de cada sucursal, en palabras', async () => {
    servidor({ 'GET /plataforma/empresas': () => json(200, empresas) });
    renderApp('/plataforma');
    const lista = await screen.findByRole('list', { name: 'Empresas' });
    expect(within(lista).getByText('Inversiones Sol del Norte')).toBeInTheDocument();
    expect(within(lista).getByText('Miraflores · Activa')).toBeInTheDocument();
    expect(within(lista).getByText('Surco · En gracia')).toBeInTheDocument();
    expect(within(lista).getByText('Barranco · Suspendida')).toBeInTheDocument();
    expect(within(lista).getByText('2 sucursales')).toBeInTheDocument();
  });

  it('una sucursal sin suscripción se dice como tal', async () => {
    servidor({
      'GET /plataforma/empresas': () =>
        json(200, [
          {
            ...empresas[0],
            sucursales: [{ id: ID.sucursalA, nombre: 'Miraflores', estadoSuscripcion: null }],
          },
        ]),
    });
    renderApp('/plataforma');
    expect(await screen.findByText('Miraflores · Sin suscripción')).toBeInTheDocument();
  });

  it('sin empresas dice qué falta', async () => {
    servidor({ 'GET /plataforma/empresas': () => json(200, []) });
    renderApp('/plataforma');
    expect(await screen.findByText('Aún no hay empresas')).toBeInTheDocument();
  });

  it('entrar a dar soporte exige un motivo', async () => {
    const s = servidor({ 'GET /plataforma/empresas': () => json(200, empresas) });
    renderApp('/plataforma');
    await userEvent.click(
      await screen.findByRole('button', { name: /Entrar a dar soporte en Cevichería La Marea/ }),
    );
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('button', { name: 'Entrar a dar soporte' }));
    expect(within(hoja).getByText('Escribe el motivo del soporte')).toBeInTheDocument();
    expect(s.llamadas.filter((l) => l.ruta.includes('soporte'))).toHaveLength(0);
  });

  it('abre el soporte con el motivo, muestra quién da soporte y permite terminarlo para volver al panel', async () => {
    let sesionAbierta = false;
    const s = servidor({
      'GET /plataforma/empresas': () => json(200, empresas),
      [`POST /plataforma/empresas/${ID.empresa}/soporte`]: () => {
        sesionAbierta = true;
        return json(201, { token: TOKEN_SOPORTE, sesion: sesionSoporte() });
      },
      'GET /sesion': () => json(200, sesionSoporte()),
      'DELETE /sesion': () => json(204),
    });
    renderApp('/plataforma');
    await userEvent.click(
      await screen.findByRole('button', {
        name: /Entrar a dar soporte en Inversiones Sol del Norte/,
      }),
    );
    const hoja = await screen.findByRole('dialog');
    await userEvent.type(within(hoja).getByLabelText('Motivo'), '  Ayuda con los horarios  ');
    await userEvent.selectOptions(within(hoja).getByLabelText(/Sucursal/), ID.sucursalB);
    await userEvent.click(within(hoja).getByRole('button', { name: 'Entrar a dar soporte' }));

    // Con la sesión de soporte y varias sucursales, pide elegir una.
    expect(await screen.findByRole('heading', { name: 'Elige tu sucursal' })).toBeInTheDocument();
    expect(sesionAbierta).toBe(true);
    expect(s.de('POST', `/plataforma/empresas/${ID.empresa}/soporte`)[0]?.cuerpo).toEqual({
      motivo: 'Ayuda con los horarios',
      sucursalId: ID.sucursalB,
    });
    expect(
      s.de('POST', `/plataforma/empresas/${ID.empresa}/soporte`)[0]?.cabeceras.get('Authorization'),
    ).toBe(`Bearer ${TOKEN_SA}`);
    expect(tokenDeSesion()).toBe(TOKEN_SOPORTE);
    expect(soporteEnCurso()?.empresaNombre).toBe('Inversiones Sol del Norte');
  });

  it('en modo soporte la app muestra en todo momento quién da soporte, y "Terminar" vuelve al panel', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SOPORTE }));
    sessionStorage.setItem(
      'restaurante.soporte',
      JSON.stringify({
        empresaId: ID.empresa,
        empresaNombre: 'Inversiones Sol del Norte',
        iniciadoEn: new Date().toISOString(),
      }),
    );
    const s = servidor({
      'GET /sesion': () =>
        json(200, { ...sesionSoporte(), sucursal: { id: ID.sucursalA, nombre: 'Miraflores' } }),
      'DELETE /sesion': () => json(204),
      'GET /plataforma/empresas': () => json(200, empresas),
    });
    renderApp('/');
    const banner = await screen.findByRole('region', { name: 'Modo soporte' });
    expect(within(banner).getByText('Soporte en Inversiones Sol del Norte')).toBeInTheDocument();
    expect(within(banner).getByText(/Ana Torres · hasta las/)).toBeInTheDocument();
    expect(screen.getByText('Estás en la cuenta de Inversiones Sol del Norte')).toBeInTheDocument();
    // En soporte se ven las opciones de Administrador.
    expect(screen.getByRole('link', { name: /^Ajustes$/ })).toBeInTheDocument();

    await userEvent.click(within(banner).getByRole('button', { name: 'Terminar' }));
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeInTheDocument();
    expect(tokenDeSesion()).toBeNull();
    expect(soporteEnCurso()).toBeNull();
    expect(sessionStorage.getItem('restaurante.plataforma')).toContain(TOKEN_SA);
    await waitFor(() => expect(s.de('DELETE', '/sesion')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Modo soporte' })).toBeNull();
  });

  it('si la sesión de soporte vence, vuelve al panel y no al ingreso de empresa', async () => {
    sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SOPORTE }));
    sessionStorage.setItem(
      'restaurante.soporte',
      JSON.stringify({
        empresaId: ID.empresa,
        empresaNombre: 'Inversiones Sol del Norte',
        iniciadoEn: new Date().toISOString(),
      }),
    );
    servidor({
      'GET /sesion': () => json(401, { codigo: 'SESION_EXPIRADA', mensaje: 'x' }),
      'GET /plataforma/empresas': () => json(200, empresas),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Empresas' })).toBeInTheDocument();
    expect(soporteEnCurso()).toBeNull();
  });

  it('salir del panel cierra la sesión de plataforma', async () => {
    const s = servidor({
      'GET /plataforma/empresas': () => json(200, empresas),
      'DELETE /plataforma/sesion': () => json(204),
    });
    renderApp('/plataforma');
    await screen.findByRole('heading', { name: 'Empresas' });
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(
      await screen.findByRole('heading', { name: 'Ingreso de plataforma' }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem('restaurante.plataforma')).toBeNull();
    await waitFor(() => expect(s.de('DELETE', '/plataforma/sesion')).toHaveLength(1));
  });
});
