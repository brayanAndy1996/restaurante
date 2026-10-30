import type { TrabajoResumen } from '@restaurante/contratos';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ListaDeTrabajos } from '../src/modulos/impresion/ListaDeTrabajos';
import {
  EXPLICACION_DE_TICKET_INCOMPLETO,
  salioIncompleto,
} from '../src/modulos/impresion/trabajos';
import { json, renderApp } from './ayudas';
import { ORDEN_ID, servidorDeCuenta } from './ayudas-comandero';
import { itemDeOrden, ordenDeMesa, sesionDeRol } from './ayudas-salon';

// spec: 004-salon-cocina, criterio 126 en la interfaz (un ticket que salió recortado se dice en la lista y en
// «Tickets impresos» de la cuenta; pruebas no protegidas). La API lo marca con `incompleto`.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const trabajo = (n: number, extra: Partial<TrabajoResumen> = {}): TrabajoResumen => ({
  id: uuid(800 + n),
  tipo: 'COMANDA',
  impresora: { id: uuid(101), nombre: 'Cocina' },
  mesa: '4',
  estado: 'IMPRESO',
  intentos: 1,
  creadoEn: '2026-10-30T17:00:00.000Z',
  impresoEn: '2026-10-30T17:00:05.000Z',
  reimpresionDe: null,
  ordenId: uuid(900),
  envioNumero: 1,
  ...extra,
});

const lista = (trabajos: TrabajoResumen[], conMesa = true) =>
  render(
    <ListaDeTrabajos
      etiqueta="Trabajos de hoy"
      trabajos={trabajos}
      conMesa={conMesa}
      onReimprimir={vi.fn()}
      enCurso={null}
      pendiente={false}
    />,
  );

describe('Ticket que salió incompleto', () => {
  it('lo reconoce solo cuando la API dice incompleto y el ticket sí se armó', () => {
    expect(salioIncompleto(trabajo(1, { incompleto: true }))).toBe(true);
    expect(salioIncompleto(trabajo(1, { incompleto: false }))).toBe(false);
    expect(salioIncompleto(trabajo(1))).toBe(false);
    expect(salioIncompleto(trabajo(1, { incompleto: true, sinTicket: true }))).toBe(false);
  });

  it('la lista pone la etiqueta «Incompleto» y la explicación, solo en ese ticket', () => {
    lista([trabajo(1, { incompleto: true }), trabajo(2)]);
    const filas = screen.getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(within(filas[0]!).getByText('Incompleto')).toBeVisible();
    expect(within(filas[0]!).getByText(EXPLICACION_DE_TICKET_INCOMPLETO)).toBeVisible();
    // Sigue diciendo que se imprimió: salió, pero recortado.
    expect(within(filas[0]!).getByText('Impreso')).toBeVisible();
    expect(within(filas[1]!).queryByText('Incompleto')).toBeNull();
    expect(within(filas[1]!).queryByText(EXPLICACION_DE_TICKET_INCOMPLETO)).toBeNull();
  });

  it('dice el texto exacto de la explicación', () => {
    expect(EXPLICACION_DE_TICKET_INCOMPLETO).toBe(
      'El ticket era demasiado largo y salió recortado. Revisa la cuenta en la app.',
    );
  });

  it('también en la cuenta (sin columna de mesa) y junto a «Reimpresión»', () => {
    lista([trabajo(1, { incompleto: true, reimpresionDe: uuid(801) })], false);
    const fila = screen.getByRole('listitem');
    expect(within(fila).getByText('Incompleto')).toBeVisible();
    expect(within(fila).getByText('Reimpresión')).toBeVisible();
    expect(within(fila).getByText(EXPLICACION_DE_TICKET_INCOMPLETO)).toBeVisible();
  });

  it('un ticket que no se pudo armar no dice «Incompleto»', () => {
    lista([trabajo(1, { incompleto: true, sinTicket: true, estado: 'PENDIENTE', intentos: 0 })]);
    const fila = screen.getByRole('listitem');
    expect(within(fila).getByText('No se pudo armar el ticket')).toBeVisible();
    expect(within(fila).queryByText('Incompleto')).toBeNull();
    expect(within(fila).queryByText(EXPLICACION_DE_TICKET_INCOMPLETO)).toBeNull();
  });
});

describe('«Tickets impresos» de la cuenta', () => {
  beforeEach(() => {
    vi.spyOn(espera, 'dormir').mockResolvedValue();
    guardarTokenDeSesion(
      'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto',
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marca el ticket recortado con la etiqueta y la explicación', async () => {
    servidorDeCuenta({
      sesion: sesionDeRol('MOZO'),
      orden: ordenDeMesa(4, {
        total: '28.00',
        items: [itemDeOrden(1, { nombre: 'Lomo saltado' })],
      }),
      extra: {
        'GET /impresion/trabajos': () =>
          json(200, [
            trabajo(1, { ordenId: ORDEN_ID, incompleto: true }),
            trabajo(2, { ordenId: ORDEN_ID, tipo: 'PRECUENTA', envioNumero: null }),
          ]),
      },
    });
    renderApp(`/salon/ordenes/${ORDEN_ID}`);
    await userEvent.click(await screen.findByRole('button', { name: /Tickets impresos/ }));
    const comanda = await screen.findByRole('region', { name: 'Tickets: Comanda' });
    expect(within(comanda).getByText('Incompleto')).toBeVisible();
    expect(within(comanda).getByText(EXPLICACION_DE_TICKET_INCOMPLETO)).toBeVisible();
    const otros = screen.getByRole('region', {
      name: 'Tickets: Marchas, anulaciones y pre-cuentas',
    });
    expect(within(otros).queryByText('Incompleto')).toBeNull();
  });
});
