import type { CartaPublica } from '@restaurante/contratos';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartaWeb, etiquetaDeMesa, variablesDeMarca } from '../componentes/CartaWeb';

// La carta armada en el servidor (criterio 81), probada como componente.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const carta: CartaPublica = {
  empresa: { nombre: 'Sabor Norteño', logoUrl: null, colorPrincipal: '#F2A900' },
  sucursal: {
    nombre: 'Miraflores',
    slug: 'miraflores',
    direccion: 'Av. Larco 345, Miraflores',
    horario: [],
    abiertaAhora: null,
  },
  familias: [
    {
      id: id(1),
      nombre: 'Entradas',
      productos: [
        {
          id: id(10),
          tipo: 'SIMPLE',
          nombre: 'Causa limeña',
          descripcion: 'Papa amarilla con pollo.',
          fotoUrl: null,
          precio: '22.50',
          grupos: [],
          componentes: [],
        },
      ],
    },
    {
      id: id(2),
      nombre: 'Menú del día',
      productos: [
        {
          id: id(11),
          tipo: 'COMBO',
          nombre: 'Combo familiar',
          descripcion: null,
          fotoUrl: null,
          precio: '89.90',
          grupos: [
            {
              id: id(20),
              nombre: 'Bebida',
              seleccion: 'UNICA',
              minimo: 1,
              maximo: 1,
              obligatorio: true,
              modificadores: [
                { id: id(30), nombre: 'Chicha', precioExtra: '0.00' },
                { id: id(31), nombre: 'Limonada', precioExtra: '3.00' },
              ],
            },
          ],
          componentes: [
            { nombre: 'Lomo saltado', cantidad: 2 },
            { nombre: 'Postre', cantidad: 1 },
          ],
        },
      ],
    },
  ],
};

const props = { carta, empresaSlug: 'sabor', sucursalSlug: 'miraflores' };

describe('CartaWeb', () => {
  it('tiene un h1 con el nombre y un h2 por familia', () => {
    render(<CartaWeb {...props} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sabor Norteño' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Entradas',
      'Menú del día',
    ]);
  });

  it('las familias son enlaces a sus secciones y hay un "Ir a la carta"', () => {
    render(<CartaWeb {...props} />);
    const nav = screen.getByRole('navigation', { name: 'Secciones de la carta' });
    const enlace = within(nav).getByRole('link', { name: 'Menú del día' });
    expect(enlace).toHaveAttribute('href', `#f-${id(2)}`);
    expect(document.getElementById(`f-${id(2)}`)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Ir a la carta' })).toHaveAttribute('href', '#carta');
  });

  it('el precio se ve como S/ 22.50 y se lee como "22 soles con 50 céntimos"', () => {
    render(<CartaWeb {...props} />);
    const texto = (esperado: string) => (_: string, el: Element | null) =>
      el?.textContent === esperado;
    expect(screen.getByText(texto('S/\u00a022.50'))).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('22 soles con 50 céntimos')).toBeInTheDocument();
  });

  it('un combo dice qué incluye y sus opciones, con el extra si lo hay', () => {
    render(<CartaWeb {...props} />);
    expect(screen.getByText(/2 × Lomo saltado, Postre/)).toBeInTheDocument();
    expect(screen.getByText('Chicha')).toBeInTheDocument();
    const texto = (esperado: string) => (_: string, el: Element | null) =>
      el?.textContent === esperado;
    expect(screen.getByText(texto('Limonada (+ S/\u00a03.00)'))).toBeInTheDocument();
  });

  it('en la carta sale la dirección; en el modo mesa sale "Mesa 4" y no la dirección', () => {
    const { unmount } = render(<CartaWeb {...props} />);
    expect(screen.getByText('Av. Larco 345, Miraflores')).toBeInTheDocument();
    unmount();
    render(<CartaWeb {...props} mesa="4" />);
    expect(screen.getByText('Mesa 4')).toBeInTheDocument();
    expect(screen.queryByText('Av. Larco 345, Miraflores')).toBeNull();
  });

  it('un producto sin foto no deja hueco ni imagen', () => {
    render(<CartaWeb {...props} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('cada producto lleva su gancho para la disponibilidad', () => {
    render(<CartaWeb {...props} />);
    expect(document.querySelector(`[data-producto-id="${id(10)}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-modificador-id="${id(31)}"]`)).not.toBeNull();
  });

  it('una carta sin platos lo dice con palabras', () => {
    render(<CartaWeb {...props} carta={{ ...carta, familias: [] }} />);
    expect(screen.getByText('Por ahora no hay platos disponibles.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('deja un lugar para la barra de abajo del modo mesa', () => {
    render(<CartaWeb {...props} mesa="4" barra={<div role="region" aria-label="Tu mesa" />} />);
    expect(screen.getByRole('region', { name: 'Tu mesa' })).toBeInTheDocument();
  });
});

describe('variablesDeMarca', () => {
  it('un color claro se conserva y lleva texto casi negro', () => {
    expect(variablesDeMarca('#f2a900')).toEqual({
      '--marca': '#F2A900',
      '--sobre-marca': '#111111',
      '--indicador': '#111111',
    });
  });

  it('un color oscuro lleva texto blanco', () => {
    expect(variablesDeMarca('#1D4A9E')).toEqual({
      '--marca': '#1D4A9E',
      '--sobre-marca': '#FFFFFF',
      '--indicador': '#1D4A9E',
    });
  });
});

describe('etiquetaDeMesa', () => {
  it('un número es "Mesa N" y un nombre se queda como está', () => {
    expect(etiquetaDeMesa('4')).toBe('Mesa 4');
    expect(etiquetaDeMesa('Terraza 2')).toBe('Terraza 2');
  });
});
