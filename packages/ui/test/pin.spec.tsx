import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CuposDelEquipo, PinUnaVez, PuntosPin, TecladoNumerico } from '../src';

describe('TecladoNumerico', () => {
  it('entrega cada dígito y el borrado', async () => {
    const alDigito = vi.fn();
    const alBorrar = vi.fn();
    render(<TecladoNumerico onDigito={alDigito} onBorrar={alBorrar} />);
    await userEvent.click(screen.getByRole('button', { name: '7' }));
    await userEvent.click(screen.getByRole('button', { name: '0' }));
    await userEvent.click(screen.getByRole('button', { name: 'Borrar el último dígito' }));
    expect(alDigito.mock.calls).toEqual([['7'], ['0']]);
    expect(alBorrar).toHaveBeenCalledTimes(1);
  });

  it('tiene los diez dígitos y la tecla de borrar', () => {
    render(<TecladoNumerico onDigito={() => undefined} onBorrar={() => undefined} />);
    for (const d of '0123456789')
      expect(screen.getByRole('button', { name: d })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(11);
  });

  it('desactivado no entrega nada', async () => {
    const alDigito = vi.fn();
    render(<TecladoNumerico onDigito={alDigito} onBorrar={() => undefined} deshabilitado />);
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    expect(alDigito).not.toHaveBeenCalled();
  });
});

describe('PuntosPin', () => {
  it('dice "2 de 4 dígitos" sin mostrar ningún dígito', () => {
    render(<PuntosPin largo={4} llenos={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('2 de 4 dígitos');
  });
});

describe('CuposDelEquipo', () => {
  it('dice cuántas personas recuerda el celular', () => {
    render(<CuposDelEquipo usados={3} maximo={5} />);
    expect(screen.getByText('Este celular recuerda a 3 de 5 personas.')).toBeInTheDocument();
  });
});

describe('PinUnaVez', () => {
  it('muestra el PIN y la nota de una sola vez', () => {
    render(<PinUnaVez nombre="Rosa Quispe" pin="4821" onListo={() => undefined} />);
    expect(screen.getByText('4821')).toBeInTheDocument();
    expect(screen.getByText('PIN de Rosa Quispe')).toBeInTheDocument();
    expect(screen.getByText('Se muestra una sola vez')).toBeInTheDocument();
  });

  it('copia el PIN al portapapeles y lo dice', async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: escribir },
      configurable: true,
    });
    render(<PinUnaVez nombre="Rosa" pin="482109" onListo={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copiar PIN' }));
    expect(escribir).toHaveBeenCalledWith('482109');
    expect(await screen.findByRole('button', { name: 'PIN copiado' })).toBeInTheDocument();
  });

  it('"Ya lo anoté" avisa a quien lo mostró', async () => {
    const alListo = vi.fn();
    render(<PinUnaVez nombre="Rosa" pin="4821" onListo={alListo} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ya lo anoté' }));
    expect(alListo).toHaveBeenCalledTimes(1);
  });
});
