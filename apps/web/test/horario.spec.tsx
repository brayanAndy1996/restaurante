import type { TramoHorario } from '@restaurante/dominio';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DatoDeHorario } from '../componentes/DatoDeHorario';
import { estadoDeHorario, resumenDeHorario, tablaDeHorario } from '../lib/horario';
import { actualizarHorario, filaVigente, type TablaDeHorario } from '../lib/horario-vivo';

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

describe('tablaDeHorario (el servidor arma las transiciones de las próximas 48 h)', () => {
  it('sin horario va vacía', () => {
    expect(tablaDeHorario([], lima(LUNES, '18:00')).filas).toEqual([]);
  });

  it('empieza con la fila de ahora y sigue con cada cambio, con el texto que daría estadoDeHorario', () => {
    const ahora = lima(LUNES, '10:00');
    const { filas, hasta } = tablaDeHorario(semana, ahora);
    expect(hasta).toBe(ahora.getTime() + 48 * 3600_000);
    expect(filas[0]).toEqual({
      desde: ahora.getTime(),
      abierto: false,
      texto: 'Cerrado ahora · abre a las 12:00',
    });
    expect(filas[1]).toEqual({
      desde: lima(LUNES, '12:00').getTime(),
      abierto: true,
      texto: 'Abierto ahora · hasta las 23:00',
    });
    // Al cerrar a las 23:00 dice "abre mañana"; pasada la medianoche de Lima vuelve a decir "abre".
    expect(filas[2]).toEqual({
      desde: lima(LUNES, '23:00').getTime(),
      abierto: false,
      texto: 'Cerrado ahora · abre mañana a las 12:00',
    });
    expect(filas[3]).toEqual({
      desde: lima(LUNES + 1, '00:00').getTime(),
      abierto: false,
      texto: 'Cerrado ahora · abre a las 12:00',
    });
  });

  it('cada fila coincide con estadoDeHorario en ese instante y un minuto antes de la siguiente', () => {
    const ahora = lima(LUNES, '10:00');
    const { filas, hasta } = tablaDeHorario(semana, ahora);
    filas.forEach((fila, i) => {
      const fin = filas[i + 1]?.desde ?? hasta;
      for (const instante of [fila.desde, fin - 60_000]) {
        const estado = estadoDeHorario(semana, new Date(instante));
        expect({ abierto: fila.abierto, texto: fila.texto }).toEqual(estado);
      }
    });
  });

  it('un tramo que cruza la medianoche (sábado hasta las 02:00) cambia a las 02:00 del domingo', () => {
    const { filas } = tablaDeHorario(semana, lima(7, '20:00'));
    expect(filas[0]?.texto).toBe('Abierto ahora · hasta las 02:00');
    expect(filas[1]).toMatchObject({ desde: lima(8, '02:00').getTime(), abierto: false });
  });
});

describe('filaVigente (el navegador elige la fila de su hora)', () => {
  const tabla: TablaDeHorario = {
    hasta: 5000,
    filas: [
      { desde: 1000, abierto: false, texto: 'cerrado' },
      { desde: 2000, abierto: true, texto: 'abierto' },
      { desde: 3000, abierto: false, texto: 'cerrado otra vez' },
    ],
  };

  it('antes de la primera fila no elige ninguna', () => {
    expect(filaVigente(tabla, 999)).toBeNull();
  });

  it('en cada transición ya vale la nueva, y un instante antes la anterior', () => {
    expect(filaVigente(tabla, 1000)?.texto).toBe('cerrado');
    expect(filaVigente(tabla, 1999)?.texto).toBe('cerrado');
    expect(filaVigente(tabla, 2000)?.texto).toBe('abierto');
    expect(filaVigente(tabla, 2999)?.texto).toBe('abierto');
    expect(filaVigente(tabla, 3000)?.texto).toBe('cerrado otra vez');
    expect(filaVigente(tabla, 4999)?.texto).toBe('cerrado otra vez');
  });

  it('con la tabla agotada o vacía no elige nada (queda el texto del servidor)', () => {
    expect(filaVigente(tabla, 5000)).toBeNull();
    expect(filaVigente({ hasta: 5000, filas: [] }, 2000)).toBeNull();
  });
});

describe('actualizarHorario', () => {
  const montar = () => {
    render(<DatoDeHorario horario={semana} ahora={lima(LUNES, '10:00')} />);
    return screen.getByText(/Cerrado ahora/).closest('p')!;
  };
  const tabla = tablaDeHorario(semana, lima(LUNES, '10:00'));

  it('cambia el texto y data-abierto cuando el navegador ya pasó la apertura', () => {
    const dato = montar();
    expect(dato).toHaveAttribute('data-abierto', 'false');
    actualizarHorario(document, tabla, lima(LUNES, '13:00').getTime());
    expect(screen.getByText('Abierto ahora · hasta las 23:00')).toBeInTheDocument();
    expect(dato).toHaveAttribute('data-abierto', 'true');
  });

  it('con la tabla agotada deja el texto del servidor', () => {
    const dato = montar();
    actualizarHorario(document, tabla, lima(LUNES + 3, '13:00').getTime());
    expect(dato).toHaveTextContent('Cerrado ahora · abre a las 12:00');
    expect(dato).toHaveAttribute('data-abierto', 'false');
  });
});
