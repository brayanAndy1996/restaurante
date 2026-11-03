import type { TramoHorario } from '@restaurante/dominio';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatoDeHorario } from '../componentes/DatoDeHorario';
import { estadoDeHorario, resumenDeHorario } from '../lib/horario';

// Horario de la cabecera (criterio 81). Lima es UTC−5: el lunes 2 de noviembre de 2026 a las 18:00 en Lima son
// las 23:00 UTC. Las fechas se escriben en UTC para que la prueba no dependa de la zona de quien la corre.
const lima = (dia: number, hora: string) =>
  new Date(`2026-11-${String(dia).padStart(2, '0')}T${hora}:00-05:00`);
const LUNES = 2;

const semana: TramoHorario[] = [
  ...[1, 2, 3, 4, 5].map((dia) => ({ dia, desde: '12:00', hasta: '23:00' })),
  { dia: 6, desde: '12:00', hasta: '02:00' },
  { dia: 7, desde: '12:00', hasta: '18:00' },
];

describe('estadoDeHorario', () => {
  it('sin horario cargado no dice nada', () => {
    expect(estadoDeHorario([], lima(LUNES, '18:00'))).toBeNull();
  });

  it('abierto: dice hasta qué hora', () => {
    expect(estadoDeHorario(semana, lima(LUNES, '18:00'))).toEqual({
      abierto: true,
      texto: 'Abierto ahora · hasta las 23:00',
    });
  });

  it('cerrado antes de abrir el mismo día: dice a qué hora abre', () => {
    expect(estadoDeHorario(semana, lima(LUNES, '09:30'))).toEqual({
      abierto: false,
      texto: 'Cerrado ahora · abre a las 12:00',
    });
  });

  it('cerrado después de cerrar: abre mañana', () => {
    expect(estadoDeHorario(semana, lima(LUNES, '23:30'))?.texto).toBe(
      'Cerrado ahora · abre mañana a las 12:00',
    );
  });

  it('cerrado varios días: dice el día', () => {
    const soloLunesYJueves = [
      { dia: 1, desde: '12:00', hasta: '23:00' },
      { dia: 4, desde: '12:00', hasta: '23:00' },
    ];
    expect(estadoDeHorario(soloLunesYJueves, lima(LUNES, '23:30'))?.texto).toBe(
      'Cerrado ahora · abre el jueves a las 12:00',
    );
  });

  it('un tramo que cruza la medianoche sigue abierto de madrugada', () => {
    expect(estadoDeHorario(semana, lima(8, '00:30'))).toEqual({
      abierto: true,
      texto: 'Abierto ahora · hasta las 02:00',
    });
  });

  it('el domingo después de cerrar: abre el lunes', () => {
    expect(estadoDeHorario(semana, lima(8, '20:00'))?.texto).toBe(
      'Cerrado ahora · abre mañana a las 12:00',
    );
  });

  it('dos tramos seguidos se dicen como uno', () => {
    const partido = [
      { dia: 1, desde: '12:00', hasta: '15:00' },
      { dia: 1, desde: '15:00', hasta: '22:00' },
    ];
    expect(estadoDeHorario(partido, lima(LUNES, '13:00'))?.texto).toBe(
      'Abierto ahora · hasta las 22:00',
    );
  });

  it('un descanso entre dos tramos es cerrado y dice cuándo vuelve', () => {
    const conDescanso = [
      { dia: 1, desde: '12:00', hasta: '15:00' },
      { dia: 1, desde: '19:00', hasta: '23:00' },
    ];
    expect(estadoDeHorario(conDescanso, lima(LUNES, '16:00'))?.texto).toBe(
      'Cerrado ahora · abre a las 19:00',
    );
  });

  it('usa la hora de Lima y no la del servidor', () => {
    // Las 23:30 UTC son las 18:30 en Lima: abierto.
    expect(estadoDeHorario(semana, new Date('2026-11-02T23:30:00Z'))?.abierto).toBe(true);
    // Las 04:30 UTC del martes son las 23:30 del lunes en Lima: cerrado.
    expect(estadoDeHorario(semana, new Date('2026-11-03T04:30:00Z'))?.abierto).toBe(false);
  });
});

describe('resumenDeHorario', () => {
  it('junta los días seguidos con el mismo horario', () => {
    expect(resumenDeHorario(semana)).toBe(
      'lun a vie 12:00 a 23:00 · sáb 12:00 a 02:00 · dom 12:00 a 18:00',
    );
  });

  it('dos días seguidos se dicen con "y" y un día suelto, solo', () => {
    expect(
      resumenDeHorario([
        { dia: 6, desde: '10:00', hasta: '20:00' },
        { dia: 7, desde: '10:00', hasta: '20:00' },
        { dia: 3, desde: '10:00', hasta: '14:00' },
        { dia: 3, desde: '18:00', hasta: '22:00' },
      ]),
    ).toBe('mié 10:00 a 14:00 y 18:00 a 22:00 · sáb y dom 10:00 a 20:00');
  });

  it('sin horario no hay resumen', () => {
    expect(resumenDeHorario([])).toBeNull();
  });
});

describe('DatoDeHorario', () => {
  it('muestra el estado con palabras', () => {
    render(<DatoDeHorario horario={semana} ahora={lima(LUNES, '18:00')} />);
    expect(screen.getByText('Abierto ahora · hasta las 23:00')).toBeInTheDocument();
  });

  it('cerrado también se dice con palabras', () => {
    render(<DatoDeHorario horario={semana} ahora={lima(LUNES, '09:00')} />);
    expect(screen.getByText('Cerrado ahora · abre a las 12:00')).toBeInTheDocument();
  });

  it('sin horario no dibuja nada', () => {
    const { container } = render(<DatoDeHorario horario={[]} ahora={lima(LUNES, '18:00')} />);
    expect(container).toBeEmptyDOMElement();
  });
});
