import type { TramoHorario } from '@restaurante/dominio';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorDeHorario, erroresDeHorario, mismoHorario, ordenarTramos } from '../src';

function Prueba({ inicial = [] as TramoHorario[] }) {
  const [valor, setValor] = useState<TramoHorario[]>(inicial);
  return (
    <>
      <EditorDeHorario valor={valor} onCambio={setValor} />
      <output data-testid="json">{JSON.stringify(valor)}</output>
    </>
  );
}

const leer = () => JSON.parse(screen.getByTestId('json').textContent ?? '[]') as TramoHorario[];

describe('EditorDeHorario', () => {
  it('muestra los siete días, sin acceso por defecto', () => {
    render(<Prueba />);
    expect(screen.getAllByText('Sin acceso')).toHaveLength(7);
  });

  it('agrega un tramo que cruza la medianoche tal cual', async () => {
    render(<Prueba />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar tramo el viernes' }));
    const grupo = screen.getByRole('group', { name: 'Tramo del viernes' });
    const desde = within(grupo).getByLabelText('Desde');
    const hasta = within(grupo).getByLabelText('Hasta');
    await userEvent.clear(desde);
    await userEvent.type(desde, '18:00');
    await userEvent.clear(hasta);
    await userEvent.type(hasta, '02:00');
    await userEvent.click(within(grupo).getByRole('button', { name: 'Agregar tramo' }));
    expect(leer()).toEqual([{ dia: 5, desde: '18:00', hasta: '02:00' }]);
    expect(screen.getByText('18:00 – 02:00')).toBeInTheDocument();
  });

  it('permite varios tramos en el mismo día', () => {
    render(
      <Prueba
        inicial={[
          { dia: 2, desde: '11:00', hasta: '15:00' },
          { dia: 2, desde: '18:00', hasta: '23:00' },
        ]}
      />,
    );
    expect(screen.getByText('11:00 – 15:00')).toBeInTheDocument();
    expect(screen.getByText('18:00 – 23:00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no deja agregar un tramo con la misma hora de inicio y de fin', async () => {
    render(<Prueba />);
    await userEvent.click(screen.getByRole('button', { name: 'Agregar tramo el lunes' }));
    const grupo = screen.getByRole('group', { name: 'Tramo del lunes' });
    await userEvent.clear(within(grupo).getByLabelText('Hasta'));
    await userEvent.type(within(grupo).getByLabelText('Hasta'), '18:00');
    await userEvent.click(within(grupo).getByRole('button', { name: 'Agregar tramo' }));
    expect(within(grupo).getByRole('alert')).toHaveTextContent('no pueden ser la misma hora');
    expect(leer()).toEqual([]);
  });

  it('quita un tramo', async () => {
    render(<Prueba inicial={[{ dia: 6, desde: '11:00', hasta: '23:00' }]} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Quitar el tramo 11:00 – 23:00 del sábado' }),
    );
    expect(leer()).toEqual([]);
  });

  it('avisa en palabras cuando dos tramos del mismo día se cruzan', () => {
    render(
      <Prueba
        inicial={[
          { dia: 5, desde: '18:00', hasta: '02:00' },
          { dia: 5, desde: '23:00', hasta: '23:30' },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Los tramos del viernes se cruzan. Cambia uno de los dos.',
    );
  });

  it('un tramo del domingo que cruza la medianoche choca con el lunes', () => {
    const errores = erroresDeHorario([
      { dia: 7, desde: '22:00', hasta: '06:00' },
      { dia: 1, desde: '05:00', hasta: '08:00' },
    ]);
    expect(errores).toHaveLength(1);
    expect(errores[0]?.mensaje).toBe(
      'El tramo del lunes se cruza con uno del domingo. Cambia uno de los dos.',
    );
    expect(errores[0]?.indices.sort()).toEqual([0, 1]);
  });
});

describe('ordenarTramos y mismoHorario', () => {
  it('ordena por día y hora y compara sin importar el orden', () => {
    const a: TramoHorario[] = [
      { dia: 2, desde: '18:00', hasta: '22:00' },
      { dia: 1, desde: '11:00', hasta: '15:00' },
    ];
    expect(ordenarTramos(a)[0]?.dia).toBe(1);
    expect(mismoHorario(a, [...a].reverse())).toBe(true);
    expect(mismoHorario(a, null)).toBe(false);
    expect(mismoHorario(null, null)).toBe(true);
  });
});
