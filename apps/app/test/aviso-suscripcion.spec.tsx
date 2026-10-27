import type { AvisoSuscripcion } from '@restaurante/contratos';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { textoDeDiasDeGracia } from '../src/componentes/AvisosGlobales';
import { espera } from '../src/lib/api';
import { ID, TOKEN_SESION, json, renderApp, servidor, sesionDe } from './ayudas';

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  sessionStorage.setItem('restaurante.sesion', JSON.stringify({ token: TOKEN_SESION }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const gracia = (nombre: string, dias: number | null, suspensionDesde = '2026-11-18') => ({
  sucursalId: ID.sucursalA as string,
  nombre,
  estado: 'EN_GRACIA' as const,
  vencimiento: '2026-11-10',
  suspensionDesde,
  diasRestantesGracia: dias,
});
const suspendida = (nombre: string, sucursalId: string = ID.sucursalB) => ({
  sucursalId,
  nombre,
  estado: 'SUSPENDIDA' as const,
  vencimiento: '2026-10-01',
  suspensionDesde: '2026-10-09',
  diasRestantesGracia: null,
});

function conAviso(sucursales: AvisoSuscripcion['sucursales'] | null) {
  servidor({
    'GET /sesion': () =>
      json(200, sesionDe({ avisoSuscripcion: sucursales ? { sucursales } : null })),
  });
  renderApp('/');
}
const cenefa = () => document.querySelector('.ui-cenefa')?.getAttribute('data-estado');

describe('aviso de suscripción del Administrador (criterio 99)', () => {
  it('sin aviso no hay banner y la cenefa es la normal', async () => {
    conAviso(null);
    await screen.findByText('Hola, Marta');
    expect(screen.queryByText(/gracia/i)).toBeNull();
    expect(screen.queryByText(/suspendida/i)).toBeNull();
    expect(cenefa()).toBe('normal');
  });

  it('en gracia dice los días, la fecha de suspensión y que solo impide abrir caja', async () => {
    conAviso([gracia('Miraflores', 5)]);
    expect(await screen.findByText('Miraflores: quedan 5 días de gracia')).toBeInTheDocument();
    expect(screen.getByText('Se suspenderá el 18 de noviembre de 2026.')).toBeInTheDocument();
    expect(screen.getByText('La suspensión solo impide abrir caja.')).toBeInTheDocument();
    expect(cenefa()).toBe('gracia');
  });

  it('el último día de gracia dice "queda 1 día"', async () => {
    conAviso([gracia('Miraflores', 1)]);
    expect(await screen.findByText('Miraflores: queda 1 día de gracia')).toBeInTheDocument();
  });

  it('suspendida dice que no se puede abrir caja pero sí consultar y exportar, y la cenefa va en rocoto', async () => {
    conAviso([suspendida('Surco')]);
    expect(await screen.findByText('Surco: sucursal suspendida')).toBeInTheDocument();
    expect(
      screen.getByText(/No se puede abrir caja\. Puedes consultar y exportar tus datos\./),
    ).toBeInTheDocument();
    expect(cenefa()).toBe('suspendida');
  });

  it('con una suspendida y otra en gracia muestra los dos avisos, y la cenefa sigue la más grave', async () => {
    conAviso([gracia('Miraflores', 3), suspendida('Surco')]);
    expect(await screen.findByText('Surco: sucursal suspendida')).toBeInTheDocument();
    expect(screen.getByText('Miraflores: quedan 3 días de gracia')).toBeInTheDocument();
    expect(cenefa()).toBe('suspendida');
  });

  it('con varias sucursales en el mismo estado las junta y dice cuál cuándo', async () => {
    conAviso([
      { ...gracia('Miraflores', 5), sucursalId: ID.sucursalA },
      { ...gracia('San Isidro', 2, '2026-11-15'), sucursalId: ID.otro },
    ]);
    expect(await screen.findByText('2 sucursales en gracia')).toBeInTheDocument();
    expect(
      screen.getByText(/Miraflores: quedan 5 días\. Se suspenderá el 18 de noviembre de 2026\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/San Isidro: quedan 2 días\. Se suspenderá el 15 de noviembre de 2026\./),
    ).toBeInTheDocument();
  });

  it('con varias suspendidas dice cuántas y cuáles', async () => {
    conAviso([suspendida('Surco'), suspendida('Callao', ID.otro)]);
    expect(await screen.findByText('2 sucursales suspendidas')).toBeInTheDocument();
    expect(screen.getByText(/Surco, Callao\. No se puede abrir caja/)).toBeInTheDocument();
  });

  it('es persistente: no tiene botón para cerrarlo', async () => {
    conAviso([suspendida('Surco'), gracia('Miraflores', 3)]);
    await screen.findByText('Surco: sucursal suspendida');
    const avisos = document.querySelector('.app__avisos') as HTMLElement;
    expect(within(avisos).queryByRole('button')).toBeNull();
  });

  it('el banner está arriba de todas las pantallas de la app, no solo en el inicio', async () => {
    servidor({
      'GET /sesion': () =>
        json(200, sesionDe({ avisoSuscripcion: { sucursales: [suspendida('Surco')] } })),
      'GET /usuarios': () => json(200, []),
    });
    renderApp('/administracion/usuarios');
    expect(await screen.findByText('Surco: sucursal suspendida')).toBeInTheDocument();
  });

  it('sin conexión manda la cenefa de sin conexión, pero el aviso de suscripción sigue a la vista', async () => {
    servidor({
      'GET /sesion': () =>
        json(200, sesionDe({ avisoSuscripcion: { sucursales: [suspendida('Surco')] } })),
    });
    renderApp('/');
    await screen.findByText('Surco: sucursal suspendida');
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    expect(screen.getByText('Surco: sucursal suspendida')).toBeInTheDocument();
    expect(cenefa()).toBe('sin-conexion');
    window.dispatchEvent(new Event('online'));
  });

  it('el texto de los días', () => {
    expect(textoDeDiasDeGracia(1)).toBe('Queda 1 día');
    expect(textoDeDiasDeGracia(7)).toBe('Quedan 7 días');
    expect(textoDeDiasDeGracia(null)).toBe('Queda poco tiempo');
  });
});
