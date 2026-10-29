import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BaldosaDeMesa, CuadriculaDeMesas, type MesaDeCuadricula } from '../src';

const MESAS: MesaDeCuadricula[] = [
  { id: 'm1', nombre: '1', capacidad: 4, forma: 'CUADRADA', columna: 1, fila: 1 },
  { id: 'm2', nombre: '2', capacidad: 2, forma: 'REDONDA', columna: 3, fila: 1 },
  { id: 'm3', nombre: 'Terraza 3', capacidad: 8, forma: 'RECTANGULAR', columna: 2, fila: 2 },
];

describe('BaldosaDeMesa', () => {
  it('dice nombre, capacidad y forma en su etiqueta accesible', () => {
    render(<BaldosaDeMesa nombre="4" capacidad={6} forma="REDONDA" onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Mesa 4, 6 personas, redonda' })).toBeVisible();
  });

  it('no repite "Mesa" cuando el nombre ya lo trae y usa el singular con una persona', () => {
    render(
      <BaldosaDeMesa nombre="Mesa 9" capacidad={1} forma="CUADRADA" onClick={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Mesa 9, 1 persona, cuadrada' })).toBeVisible();
  });

  it.each([
    ['LIBRE', undefined, 'Libre'],
    ['OCUPADA', '3 · 25 min', 'Ocupada · 3 · 25 min'],
    ['EN_PRECUENTA', undefined, 'Pre-cuenta'],
  ] as const)('el estado %s se dice con texto, no solo con color', (estado, detalle, texto) => {
    render(
      <BaldosaDeMesa
        nombre="5"
        capacidad={4}
        forma="CUADRADA"
        estado={estado}
        {...(detalle ? { detalle } : {})}
        onClick={() => undefined}
      />,
    );
    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain(texto);
  });

  it('la elegida se anuncia como presionada y lleva su marca', async () => {
    const alTocar = vi.fn();
    const { rerender } = render(
      <BaldosaDeMesa nombre="5" capacidad={4} forma="CUADRADA" elegida={false} onClick={alTocar} />,
    );
    const boton = screen.getByRole('button');
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(boton);
    expect(alTocar).toHaveBeenCalledTimes(1);
    rerender(<BaldosaDeMesa nombre="5" capacidad={4} forma="CUADRADA" elegida onClick={alTocar} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    expect(boton.querySelector('.ui-mesa__marca')).not.toBeNull();
  });

  it('sin acción es solo informativa (no es un botón)', () => {
    render(<BaldosaDeMesa nombre="5" capacidad={4} forma="CUADRADA" estado="LIBRE" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: 'Mesa 5, 4 personas, cuadrada, Libre' })).toBeVisible();
  });

  it('no usa aria-pressed cuando no se puede elegir (el salón navega, no selecciona)', () => {
    render(<BaldosaDeMesa nombre="5" capacidad={4} forma="CUADRADA" onClick={() => undefined} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
  });
});

describe('CuadriculaDeMesas', () => {
  const base = { etiqueta: 'Mesas de Salón principal', columnas: 4, filas: 3, mesas: MESAS };

  it('es una cuadrícula con el nombre y el tamaño dichos para los lectores de pantalla', () => {
    render(<CuadriculaDeMesas {...base} onElegirMesa={() => undefined} />);
    const rejilla = screen.getByRole('grid', { name: 'Mesas de Salón principal' });
    expect(rejilla).toHaveAttribute('aria-rowcount', '3');
    expect(rejilla).toHaveAttribute('aria-colcount', '4');
    expect(within(rejilla).getAllByRole('row')).toHaveLength(3);
    expect(within(rejilla).getAllByRole('gridcell')).toHaveLength(12);
  });

  it('las celdas miden al menos 48 px aunque se pida menos', () => {
    const { rerender } = render(<CuadriculaDeMesas {...base} tamanoCelda={20} />);
    expect(screen.getByRole('grid').style.getPropertyValue('--celda-mesa')).toBe('48px');
    rerender(<CuadriculaDeMesas {...base} tamanoCelda={96} />);
    expect(screen.getByRole('grid').style.getPropertyValue('--celda-mesa')).toBe('96px');
    rerender(<CuadriculaDeMesas {...base} />);
    expect(screen.getByRole('grid').style.getPropertyValue('--celda-mesa')).toBe('72px');
  });

  it('pone cada mesa en su columna y fila', () => {
    render(<CuadriculaDeMesas {...base} onElegirMesa={() => undefined} />);
    const filas = screen.getAllByRole('row');
    expect(within(filas[0]!).getByRole('button', { name: /^Mesa 1,/ })).toBeVisible();
    expect(within(filas[0]!).getAllByRole('gridcell')[2]).toContainElement(
      screen.getByRole('button', { name: /^Mesa 2,/ }),
    );
    expect(within(filas[1]!).getAllByRole('gridcell')[1]).toContainElement(
      screen.getByRole('button', { name: /^Mesa Terraza 3,/ }),
    );
  });

  it('las celdas vacías solo se tocan si hay una acción para ellas', async () => {
    const { rerender } = render(<CuadriculaDeMesas {...base} onElegirMesa={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Celda libre/ })).toBeNull();
    const alElegir = vi.fn();
    rerender(
      <CuadriculaDeMesas {...base} onElegirMesa={() => undefined} onElegirCelda={alElegir} />,
    );
    expect(screen.getAllByRole('button', { name: /Celda libre/ })).toHaveLength(9);
    await userEvent.click(screen.getByRole('button', { name: 'Celda libre, columna 4, fila 3' }));
    expect(alElegir).toHaveBeenCalledWith(4, 3);
  });

  it('elegir una mesa avisa cuál y la marca como presionada', async () => {
    const alElegir = vi.fn();
    render(
      <CuadriculaDeMesas
        {...base}
        mesaElegidaId="m2"
        onElegirMesa={alElegir}
        onElegirCelda={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /^Mesa 2,/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^Mesa 1,/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: /^Mesa 1,/ }));
    expect(alElegir).toHaveBeenCalledWith('m1');
  });

  it('marca la celda vacía elegida como presionada', () => {
    render(
      <CuadriculaDeMesas
        {...base}
        celdaElegida={{ columna: 2, fila: 1 }}
        onElegirMesa={() => undefined}
        onElegirCelda={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Celda libre, columna 2, fila 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Celda libre, columna 1, fila 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('es una sola parada del tabulador y las flechas mueven el foco entre celdas', async () => {
    const usuario = userEvent.setup();
    render(
      <CuadriculaDeMesas
        {...base}
        onElegirMesa={() => undefined}
        onElegirCelda={() => undefined}
      />,
    );
    const conTab = screen.getAllByRole('button').filter((b) => b.tabIndex === 0);
    expect(conTab).toHaveLength(1);

    await usuario.tab();
    expect(document.activeElement).toBe(conTab[0]);
    expect(conTab[0]).toHaveAccessibleName(/^Mesa 1,/);
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName('Celda libre, columna 2, fila 1');
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName(/^Mesa 2,/);
    await usuario.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName('Celda libre, columna 3, fila 2');
    await usuario.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAccessibleName(/^Mesa Terraza 3,/);
    // En el borde no pasa nada.
    await usuario.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(document.activeElement).toHaveAccessibleName('Celda libre, columna 1, fila 2');
    await usuario.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName('Celda libre, columna 4, fila 2');
    await usuario.keyboard('{Home}');
    expect(document.activeElement).toHaveAccessibleName('Celda libre, columna 1, fila 2');
    // Un solo tope del tabulador sigue siendo la celda con foco.
    expect(screen.getAllByRole('button').filter((b) => b.tabIndex === 0)).toEqual([
      document.activeElement,
    ]);
  });

  it('Enter y espacio tocan la celda con foco', async () => {
    const usuario = userEvent.setup();
    const alElegir = vi.fn();
    render(<CuadriculaDeMesas {...base} onElegirMesa={alElegir} />);
    await usuario.tab();
    await usuario.keyboard('{Enter}');
    expect(alElegir).toHaveBeenLastCalledWith('m1');
    await usuario.keyboard(' ');
    expect(alElegir).toHaveBeenCalledTimes(2);
  });

  it('en el salón las flechas saltan las celdas vacías y van a la siguiente mesa', async () => {
    const usuario = userEvent.setup();
    render(<CuadriculaDeMesas {...base} onElegirMesa={() => undefined} />);
    await usuario.tab();
    expect(document.activeElement).toHaveAccessibleName(/^Mesa 1,/);
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName(/^Mesa 2,/);
    await usuario.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAccessibleName(/^Mesa 2,/);
  });

  it('muestra los estados con texto dentro de la cuadrícula', () => {
    render(
      <CuadriculaDeMesas
        {...base}
        tamanoCelda={96}
        mesas={[
          { ...MESAS[0]!, estado: 'OCUPADA', detalle: '3 · 25 min' },
          { ...MESAS[1]!, estado: 'EN_PRECUENTA' },
          { ...MESAS[2]!, estado: 'LIBRE' },
        ]}
        onElegirMesa={() => undefined}
      />,
    );
    expect(screen.getByText('Ocupada · 3 · 25 min')).toBeInTheDocument();
    expect(screen.getByText('Pre-cuenta')).toBeInTheDocument();
    expect(screen.getByText('Libre')).toBeInTheDocument();
  });

  it('si el foco queda en una celda que ya no existe, el tabulador vuelve a una celda real', async () => {
    const usuario = userEvent.setup();
    const { rerender } = render(
      <CuadriculaDeMesas
        {...base}
        onElegirMesa={() => undefined}
        onElegirCelda={() => undefined}
      />,
    );
    await usuario.tab();
    await usuario.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName('Celda libre, columna 4, fila 1');
    rerender(
      <CuadriculaDeMesas
        {...base}
        columnas={3}
        mesas={[MESAS[0]!]}
        onElegirMesa={() => undefined}
        onElegirCelda={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button').filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });
});
