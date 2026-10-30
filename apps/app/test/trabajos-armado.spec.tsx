import type { TrabajoResumen } from '@restaurante/contratos';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListaDeTrabajos } from '../src/modulos/impresion/ListaDeTrabajos';
import { EXPLICACION_DE_ARMADO_FALLIDO, noSePudoArmar } from '../src/modulos/impresion/trabajos';

// spec: 004-salon-cocina, criterio 128 (un ticket que no se pudo armar se dice en la lista; pruebas no
// protegidas). La API marca el ticket con `sinTicket`; `ultimoError` es el detalle técnico y no se muestra.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const trabajo = (n: number, extra: Partial<TrabajoResumen> = {}): TrabajoResumen => ({
  id: uuid(700 + n),
  tipo: 'COMANDA',
  impresora: { id: uuid(101), nombre: 'Cocina' },
  mesa: '4',
  estado: 'PENDIENTE',
  intentos: 0,
  creadoEn: '2026-10-30T17:00:00.000Z',
  impresoEn: null,
  reimpresionDe: null,
  ordenId: uuid(900),
  envioNumero: 1,
  ...extra,
});

describe('Ticket que no se pudo armar', () => {
  it('lo reconoce solo cuando la API dice sinTicket', () => {
    expect(noSePudoArmar(trabajo(1, { sinTicket: true }))).toBe(true);
    expect(noSePudoArmar(trabajo(1, { sinTicket: false }))).toBe(false);
    expect(noSePudoArmar(trabajo(1, { ultimoError: 'La impresora no respondió' }))).toBe(false);
    expect(noSePudoArmar(trabajo(1))).toBe(false);
  });

  it('la lista dice «No se pudo armar el ticket» con una explicación corta, solo en ese ticket', () => {
    render(
      <ListaDeTrabajos
        etiqueta="Trabajos de hoy"
        trabajos={[
          trabajo(1, { sinTicket: true, ultimoError: 'RENDER: línea demasiado larga' }),
          trabajo(2, { ultimoError: 'La impresora no respondió', intentos: 2 }),
        ]}
        onReimprimir={vi.fn()}
        enCurso={null}
        pendiente={false}
      />,
    );
    const filas = screen.getAllByRole('listitem');
    expect(filas).toHaveLength(2);
    expect(within(filas[0]!).getByText('No se pudo armar el ticket')).toBeVisible();
    expect(within(filas[0]!).getByText(EXPLICACION_DE_ARMADO_FALLIDO)).toBeVisible();
    // Ni «Pendiente» ni el detalle técnico: el ticket no existe, no está esperando a la impresora.
    expect(within(filas[0]!).queryByText('Pendiente')).toBeNull();
    expect(filas[0]).not.toHaveTextContent('RENDER');
    expect(within(filas[1]!).queryByText('No se pudo armar el ticket')).toBeNull();
    expect(within(filas[1]!).getByText('Pendiente')).toBeVisible();
    expect(within(filas[1]!).getByText('2 intentos')).toBeVisible();
  });
});
