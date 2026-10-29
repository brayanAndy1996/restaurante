import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  MINUTOS_DE_ATRASO,
  MINUTOS_DE_DEMORA,
  TarjetaKds,
  Temporizador,
  minutosTranscurridos,
  nivelDeTiempo,
  textoDeMinutos,
  type LineaDeTarjetaKds,
  type PropsTarjetaKds,
} from '../src';

const AHORA = Date.parse('2026-10-29T17:00:00.000Z');
const haceMin = (m: number) => new Date(AHORA - m * 60_000).toISOString();

describe('nivelDeTiempo y minutosTranscurridos', () => {
  it('los umbrales son 10 y 20 minutos', () => {
    expect(MINUTOS_DE_DEMORA).toBe(10);
    expect(MINUTOS_DE_ATRASO).toBe(20);
    expect([0, 9, 10, 19, 20, 90].map(nivelDeTiempo)).toEqual([
      'normal',
      'normal',
      'demora',
      'demora',
      'atraso',
      'atraso',
    ]);
  });

  it('cuenta minutos enteros, nunca negativos, desde un texto o desde ms', () => {
    expect(minutosTranscurridos(haceMin(9), AHORA)).toBe(9);
    expect(minutosTranscurridos(AHORA - 9 * 60_000 - 59_000, AHORA)).toBe(9);
    expect(minutosTranscurridos(haceMin(-5), AHORA)).toBe(0);
    expect(minutosTranscurridos('no es una fecha', AHORA)).toBe(0);
  });

  it('dice los minutos y las horas', () => {
    expect(textoDeMinutos(7)).toBe('7 min');
    expect(textoDeMinutos(65)).toBe('1 h 05 min');
  });
});

describe('Temporizador', () => {
  const dibujar = (minutos: number) => {
    render(<Temporizador desde={haceMin(minutos)} ahora={AHORA} />);
    return screen.getByRole('timer');
  };

  it('menos de 10 minutos: normal, sin palabra de aviso', () => {
    const t = dibujar(9);
    expect(t).toHaveAttribute('data-nivel', 'normal');
    expect(t).toHaveAccessibleName('9 min');
    expect(within(t).queryByText('Demora')).toBeNull();
    expect(within(t).queryByText('Atrasada')).toBeNull();
  });

  it('de 10 a 19: ají y la palabra "Demora"', () => {
    const t = dibujar(10);
    expect(t).toHaveAttribute('data-nivel', 'demora');
    expect(t).toHaveAccessibleName('10 min, demora');
    expect(within(t).getByText('Demora')).toBeInTheDocument();
  });

  it('desde 20: rocoto y la palabra "Atrasada"', () => {
    const t = dibujar(20);
    expect(t).toHaveAttribute('data-nivel', 'atraso');
    expect(t).toHaveAccessibleName('20 min, atrasada');
    expect(within(t).getByText('Atrasada')).toBeInTheDocument();
  });
});

const linea = (n: number, extra: Partial<LineaDeTarjetaKds> = {}): LineaDeTarjetaKds => ({
  id: `linea-${n}`,
  cantidad: 1,
  nombre: `Plato ${n}`,
  contexto: null,
  modificadores: [],
  observacion: null,
  esperar: false,
  paraLlevar: false,
  estado: 'ENVIADO',
  ...extra,
});

function tarjeta(props: Partial<PropsTarjetaKds> = {}) {
  const alCambiarEstado = vi.fn();
  const alTodoListo = vi.fn();
  const alEnterado = vi.fn();
  render(
    <TarjetaKds
      tipo="COMANDA"
      mesa="Mesa 4"
      mozo="Ana Ríos"
      comensales={1}
      estacion="Cocina"
      creadaEn={haceMin(3)}
      ahora={AHORA}
      lineas={[linea(1)]}
      alCambiarEstado={alCambiarEstado}
      alTodoListo={alTodoListo}
      alEnterado={alEnterado}
      {...props}
    />,
  );
  return { alCambiarEstado, alTodoListo, alEnterado };
}

describe('TarjetaKds', () => {
  it('lleva mesa, mozo, comensales, estación y el tiempo', () => {
    tarjeta();
    const t = screen.getByRole('article', { name: 'Comanda, Mesa 4, Cocina' });
    expect(within(t).getByRole('heading', { name: 'Mesa 4' })).toBeInTheDocument();
    expect(t).toHaveTextContent('Ana Ríos · 1 comensal · Cocina');
    expect(within(t).getByRole('timer')).toHaveAccessibleName('3 min');
  });

  it('"Preparando" y "Listo" avisan con la línea y el estado', async () => {
    const { alCambiarEstado } = tarjeta({ lineas: [linea(1), linea(2)] });
    await userEvent.click(screen.getByRole('button', { name: 'Preparando: Plato 2' }));
    expect(alCambiarEstado).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'linea-2' }),
      'EN_PREPARACION',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Listo: Plato 1' }));
    expect(alCambiarEstado).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'linea-1' }),
      'LISTO',
    );
  });

  it('una línea en preparación muestra "Preparando" marcado y no lo vuelve a mandar', async () => {
    const { alCambiarEstado } = tarjeta({ lineas: [linea(1, { estado: 'EN_PREPARACION' })] });
    const boton = screen.getByRole('button', { name: 'Preparando: Plato 1' });
    expect(boton).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(boton);
    expect(alCambiarEstado).not.toHaveBeenCalled();
  });

  it('una línea lista cambia sus botones por "Deshacer"', async () => {
    const { alCambiarEstado } = tarjeta({
      lineas: [linea(1, { estado: 'LISTO' }), linea(2)],
    });
    expect(screen.queryByRole('button', { name: 'Listo: Plato 1' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer el listo: Plato 1' }));
    expect(alCambiarEstado).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'linea-1' }),
      'ENVIADO',
    );
  });

  it('una línea anulada no tiene botones y se dice "Anulado"', () => {
    tarjeta({ lineas: [linea(1, { estado: 'ANULADO' }), linea(2)] });
    expect(screen.getByText('Anulado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Listo: Plato 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Listo: Plato 2' })).toBeInTheDocument();
  });

  it('"Todo listo" solo está si queda algo por preparar', async () => {
    const { alTodoListo } = tarjeta();
    await userEvent.click(screen.getByRole('button', { name: 'Todo listo, Mesa 4' }));
    expect(alTodoListo).toHaveBeenCalledTimes(1);
  });

  it('con todo listo no ofrece "Todo listo"', () => {
    tarjeta({ lineas: [linea(1, { estado: 'LISTO' })] });
    expect(screen.queryByRole('button', { name: /Todo listo/ })).toBeNull();
  });

  it('marchar y anulación piden "Enterado"; la anulación dice el motivo', async () => {
    const { alEnterado } = tarjeta({ tipo: 'ANULACION', motivo: 'Error del mozo' });
    expect(screen.getByText(/No lo prepares/)).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Error del mozo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Preparando/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Enterado, Mesa 4' }));
    expect(alEnterado).toHaveBeenCalledTimes(1);
  });

  it('en modo reciente no muestra el tiempo grande ni acciones de la comanda', () => {
    tarjeta({ modo: 'reciente', lineas: [linea(1, { estado: 'LISTO' })] });
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByText('Hace 3 min')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Todo listo|Enterado/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deshacer el listo: Plato 1' })).toBeInTheDocument();
  });

  it('marca la comanda nueva y el cambio que espera la red, con palabras', () => {
    tarjeta({ nueva: true, esperandoRed: true });
    expect(screen.getByText('Nueva')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de envío')).toBeInTheDocument();
  });

  it('muestra "Esperar", "Para llevar", la nota y los modificadores', () => {
    tarjeta({
      lineas: [
        linea(1, {
          cantidad: 3,
          esperar: true,
          paraLlevar: true,
          observacion: 'Sin sal',
          modificadores: ['Bien cocido'],
          contexto: 'Combo familiar',
        }),
      ],
    });
    expect(screen.getByText('3 ×')).toBeInTheDocument();
    expect(screen.getByText('Esperar')).toBeInTheDocument();
    expect(screen.getByText('Para llevar')).toBeInTheDocument();
    expect(screen.getByText('Sin sal')).toBeInTheDocument();
    expect(screen.getByText('Bien cocido')).toBeInTheDocument();
    expect(screen.getByText('Combo familiar')).toBeInTheDocument();
  });
});
