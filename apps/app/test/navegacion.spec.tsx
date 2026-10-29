import type { SesionRespuesta } from '@restaurante/contratos';
import type { Modulo, Rol } from '@restaurante/dominio';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { destinoInicial, destinosDeNavegacion } from '../src/modulos/acceso/navegacion';
import { json, renderApp, servidor } from './ayudas';
import { mesa, salon, sesionDeRol, uuid, zona } from './ayudas-salon';

// spec: 004-salon-cocina, criterio 87 (navegación por rol y destino inicial; pruebas no protegidas).

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const etiquetas = (sesion: Pick<SesionRespuesta, 'permisos' | 'modulos' | 'esAdministrador'>) =>
  destinosDeNavegacion(sesion).map((d) => d.etiqueta);

const de = (rol: Rol, modulos: Modulo[] = ['SALON', 'COCINA']) => ({
  permisos: permisosDeRol(rol),
  modulos,
  esAdministrador: rol === 'ADMINISTRADOR',
});

describe('destinosDeNavegacion (criterio 87)', () => {
  it.each([
    ['MOZO', ['Salón']],
    ['CAJERO', ['Salón', 'Carta']],
    ['COCINA_BARRA', ['Cocina', 'Disponibilidad']],
    ['SUPERVISOR', ['Salón', 'Cocina', 'Disponibilidad']],
    ['ADMINISTRADOR', ['Salón', 'Cocina', 'Carta', 'Disponibilidad', 'Ajustes']],
  ] as const)('%s ve %j', (rol, esperado) => {
    expect(etiquetas(de(rol))).toEqual(esperado);
  });

  it('nunca pasa de cinco destinos', () => {
    for (const rol of ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'] as const)
      expect(destinosDeNavegacion(de(rol)).length).toBeLessThanOrEqual(5);
  });

  it('sin el módulo en el plan de la sucursal, el destino no aparece', () => {
    expect(etiquetas(de('SUPERVISOR', ['SALON']))).toEqual(['Salón', 'Disponibilidad']);
    expect(etiquetas(de('SUPERVISOR', ['COCINA']))).toEqual(['Cocina', 'Disponibilidad']);
  });

  it('quien no tiene ni Salón ni Cocina cae en Inicio, que solo existe para ellos', () => {
    expect(etiquetas(de('MOZO', []))).toEqual(['Inicio']);
    expect(etiquetas(de('ADMINISTRADOR', []))).toEqual([
      'Inicio',
      'Carta',
      'Disponibilidad',
      'Ajustes',
    ]);
    expect(etiquetas(de('MOZO'))).not.toContain('Inicio');
  });

  it('sin permisos todavía (aún no eligió sucursal) no hay destinos de trabajo', () => {
    expect(etiquetas({ permisos: null, modulos: [], esAdministrador: false })).toEqual(['Inicio']);
    expect(destinosDeNavegacion(null)).toEqual([]);
  });
});

describe('destinoInicial (criterio 87)', () => {
  it('Salón para quien atiende mesas; Cocina para quien solo usa la cocina', () => {
    expect(destinoInicial(de('MOZO'))).toBe('/salon');
    expect(destinoInicial(de('CAJERO'))).toBe('/salon');
    expect(destinoInicial(de('SUPERVISOR'))).toBe('/salon');
    expect(destinoInicial(de('ADMINISTRADOR'))).toBe('/salon');
    expect(destinoInicial(de('COCINA_BARRA'))).toBe('/cocina');
  });

  it('Cocina/Barra sin el módulo de Cocina y quien no tiene el de Salón se quedan en Inicio', () => {
    expect(destinoInicial(de('COCINA_BARRA', ['SALON']))).toBeNull();
    expect(destinoInicial(de('MOZO', ['COCINA']))).toBeNull();
    expect(destinoInicial(de('SUPERVISOR', ['COCINA']))).toBe('/cocina');
    expect(destinoInicial(null)).toBeNull();
  });
});

describe('navegación en la app', () => {
  beforeEach(() => {
    vi.spyOn(espera, 'dormir').mockResolvedValue();
    guardarTokenDeSesion(TOKEN);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function api(sesion: SesionRespuesta) {
    return servidor({
      'GET /sesion': () => json(200, sesion),
      'GET /salon': () =>
        json(200, salon([zona(uuid(1), 'Salón', [mesa(1, '1'), mesa(2, '2')])]), { ETag: '"a"' }),
    });
  }

  it('un Mozo entra en el Salón y, con un solo destino, no ve la barra de navegación', async () => {
    const s = api(sesionDeRol('MOZO'));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Salón', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('grid', { name: 'Mesas de Salón' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();
    expect(s.de('GET', '/salon')).toHaveLength(1);
  });

  it('Cocina/Barra entra en Cocina y ve Cocina y Disponibilidad', async () => {
    api(sesionDeRol('COCINA_BARRA'));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Cocina', level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Cocina', 'Disponibilidad']);
    expect(within(nav).getByRole('link', { name: 'Cocina' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('el Administrador ve los cinco destinos en su orden y entra en el Salón', async () => {
    api(sesionDeRol('ADMINISTRADOR'));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Salón', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Salón', 'Cocina', 'Carta', 'Disponibilidad', 'Ajustes']);
  });

  it('el Cajero ve Salón y Carta', async () => {
    api(sesionDeRol('CAJERO'));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Salón', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Salón', 'Carta']);
  });

  it('lo que el rol no ve tampoco se abre escribiendo la dirección: lo devuelve a su destino inicial', async () => {
    const s = api(sesionDeRol('MOZO'));
    renderApp('/cocina');
    expect(await screen.findByRole('heading', { name: 'Salón', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cocina' })).toBeNull();
    // El encabezado se pinta al montar la pantalla; la petición sale después, desde la consulta.
    await waitFor(() => expect(s.de('GET', '/salon').length).toBeGreaterThan(0));
  });

  it('Cocina/Barra no abre el Salón', async () => {
    api(sesionDeRol('COCINA_BARRA'));
    renderApp('/salon');
    expect(await screen.findByRole('heading', { name: 'Cocina', level: 1 })).toBeInTheDocument();
  });

  it('si el plan no incluye el Salón, el Mozo se queda en Inicio con un aviso claro', async () => {
    api(sesionDeRol('MOZO', { modulos: [] }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Hola, Marta' })).toBeInTheDocument();
    expect(screen.getByText('No hay pantallas de atención para ti aquí')).toBeInTheDocument();
  });
});
