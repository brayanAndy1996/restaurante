import type { SesionRespuesta } from '@restaurante/contratos';
import type { Modulo, Rol } from '@restaurante/dominio';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import {
  destinoInicial,
  destinosDeNavegacion,
  disponibilidadVaEnCocina,
} from '../src/modulos/acceso/navegacion';
import { json, renderApp, servidor } from './ayudas';
import { cocinaDe } from './ayudas-cocina';
import { mesa, salon, sesionDeRol, uuid, zona } from './ayudas-salon';

// spec: 006-caja-cobro, criterio 108 (navegación por rol; cambia el criterio 87 de 004) y 004-salon-cocina, criterio 87
// (destino inicial); pruebas no protegidas.

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const PLAN_COMPLETO: Modulo[] = ['SALON', 'COCINA', 'CAJA'];

const etiquetas = (sesion: Pick<SesionRespuesta, 'permisos' | 'modulos' | 'esAdministrador'>) =>
  destinosDeNavegacion(sesion).map((d) => d.etiqueta);

const de = (rol: Rol, modulos: Modulo[] = ['SALON', 'COCINA', 'CAJA']) => ({
  permisos: permisosDeRol(rol),
  modulos,
  esAdministrador: rol === 'ADMINISTRADOR',
});

describe('destinosDeNavegacion (criterio 108 de 006, que cambia el 87 de 004)', () => {
  it.each([
    ['MOZO', ['Salón']],
    ['CAJERO', ['Salón', 'Caja', 'Carta']],
    ['COCINA_BARRA', ['Cocina', 'Disponibilidad']],
    ['SUPERVISOR', ['Salón', 'Caja', 'Cocina', 'Disponibilidad']],
    ['ADMINISTRADOR', ['Salón', 'Caja', 'Cocina', 'Carta', 'Ajustes']],
  ] as const)('%s ve %j', (rol, esperado) => {
    expect(etiquetas(de(rol))).toEqual(esperado);
  });

  it('sin el módulo de Caja en el plan, "Caja" no aparece y el resto queda como en 004', () => {
    const sinCaja: Modulo[] = ['SALON', 'COCINA'];
    expect(etiquetas(de('CAJERO', sinCaja))).toEqual(['Salón', 'Carta']);
    expect(etiquetas(de('SUPERVISOR', sinCaja))).toEqual(['Salón', 'Cocina', 'Disponibilidad']);
    expect(etiquetas(de('ADMINISTRADOR', sinCaja))).toEqual([
      'Salón',
      'Cocina',
      'Carta',
      'Ajustes',
    ]);
  });

  it('el Mozo no tiene Caja aunque el plan la incluya: no cobra ni opera la caja', () => {
    expect(etiquetas(de('MOZO'))).not.toContain('Caja');
    expect(etiquetas(de('COCINA_BARRA'))).not.toContain('Caja');
  });

  it('"Disponibilidad" es un acceso dentro de Cocina para el Administrador; si su plan no incluye Cocina, vuelve a la barra', () => {
    expect(disponibilidadVaEnCocina(de('ADMINISTRADOR'))).toBe(true);
    expect(disponibilidadVaEnCocina(de('SUPERVISOR'))).toBe(false);
    expect(disponibilidadVaEnCocina(de('COCINA_BARRA'))).toBe(false);
    expect(disponibilidadVaEnCocina(de('ADMINISTRADOR', ['SALON', 'CAJA']))).toBe(false);
    expect(etiquetas(de('ADMINISTRADOR', ['SALON', 'CAJA']))).toEqual([
      'Salón',
      'Caja',
      'Carta',
      'Disponibilidad',
      'Ajustes',
    ]);
  });

  it('nunca pasa de cinco destinos', () => {
    for (const rol of ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR', 'ADMINISTRADOR'] as const)
      expect(destinosDeNavegacion(de(rol)).length).toBeLessThanOrEqual(5);
  });

  it('sin el módulo en el plan de la sucursal, el destino no aparece', () => {
    expect(etiquetas(de('SUPERVISOR', ['SALON']))).toEqual(['Salón', 'Disponibilidad']);
    expect(etiquetas(de('SUPERVISOR', ['COCINA']))).toEqual(['Cocina', 'Disponibilidad']);
    expect(etiquetas(de('SUPERVISOR', ['CAJA']))).toEqual(['Caja', 'Disponibilidad']);
  });

  it('quien no tiene ni Salón ni Cocina cae en Inicio, que solo existe para ellos', () => {
    expect(etiquetas(de('MOZO', []))).toEqual(['Inicio']);
    expect(etiquetas(de('ADMINISTRADOR', []))).toEqual([
      'Inicio',
      'Carta',
      'Disponibilidad',
      'Ajustes',
    ]);
    // Con solo Caja, Caja es donde aterriza (no hace falta Inicio).
    expect(etiquetas(de('CAJERO', ['CAJA']))).toEqual(['Caja', 'Carta']);
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
    expect(destinoInicial(de('CAJERO', ['CAJA']))).toBe('/caja');
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
    api(sesionDeRol('ADMINISTRADOR', { modulos: PLAN_COMPLETO }));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Salón', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Salón', 'Caja', 'Cocina', 'Carta', 'Ajustes']);
  });

  it('el Cajero ve Salón, Caja y Carta', async () => {
    api(sesionDeRol('CAJERO', { modulos: PLAN_COMPLETO }));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Salón', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Salón', 'Caja', 'Carta']);
  });

  it('el Supervisor ve Salón, Caja, Cocina y Disponibilidad', async () => {
    api(sesionDeRol('SUPERVISOR', { modulos: PLAN_COMPLETO }));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Salón', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Salón', 'Caja', 'Cocina', 'Disponibilidad']);
  });

  it('el Administrador abre Disponibilidad desde un acceso en Cocina; el Supervisor la tiene en su barra y no ve el acceso', async () => {
    const cocina = servidor({
      'GET /sesion': () => json(200, sesionDeRol('ADMINISTRADOR', { modulos: PLAN_COMPLETO })),
      'GET /cocina/comandas': () => json(200, cocinaDe([]), { ETag: '"1"' }),
    });
    renderApp('/cocina');
    expect(await screen.findByRole('heading', { name: 'Cocina', level: 1 })).toBeInTheDocument();
    const acceso = await screen.findByRole('link', { name: /^Disponibilidad/ });
    expect(acceso).toHaveAttribute('href', '/disponibilidad');
    // No está en la barra de navegación: la puerta es esta.
    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).queryByRole('link', {
        name: 'Disponibilidad',
      }),
    ).toBeNull();
    expect(cocina.de('GET', '/cocina/comandas').length).toBeGreaterThan(0);
  });

  it('un Supervisor ve el acceso a Disponibilidad solo en su barra, no dentro de Cocina', async () => {
    servidor({
      'GET /sesion': () => json(200, sesionDeRol('SUPERVISOR', { modulos: PLAN_COMPLETO })),
      'GET /cocina/comandas': () => json(200, cocinaDe([]), { ETag: '"1"' }),
    });
    renderApp('/cocina');
    expect(await screen.findByRole('heading', { name: 'Cocina', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Disponibilidad/ })).toHaveLength(1);
  });

  it('un Mozo no abre la Caja escribiendo la dirección: lo devuelve al Salón', async () => {
    api(sesionDeRol('MOZO', { modulos: PLAN_COMPLETO }));
    renderApp('/caja');
    expect(await screen.findByRole('heading', { name: 'Salón', level: 1 })).toBeInTheDocument();
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
