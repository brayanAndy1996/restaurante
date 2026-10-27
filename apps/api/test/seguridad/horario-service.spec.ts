// Pruebas del desarrollador (no protegidas) de T11: `HorarioService` con el reloj de la API.
import { describe, expect, it } from 'vitest';
import { HorarioService } from '../../src/modulos/seguridad/horario.service';
import { RelojManual } from '../../src/nucleo/reloj';

const viernesNoche = [{ dia: 5, desde: '18:00', hasta: '02:00' }];

function servicio(inicio: string) {
  const reloj = new RelojManual(inicio);
  return { reloj, horario: new HorarioService(reloj) };
}

describe('HorarioService.estaDentro', () => {
  it('sin horario, el Administrador y el principal de prueba entran a cualquier hora', () => {
    const { horario } = servicio('2026-11-02T03:00:00-05:00');
    expect(horario.estaDentro({ esAdministrador: false, horario: null })).toBe(true);
    expect(horario.estaDentro({ esAdministrador: true, horario: null })).toBe(true);
    // El Administrador nunca tiene horario; si por error llevara uno, no lo limita.
    expect(horario.estaDentro({ esAdministrador: true, horario: viernesNoche })).toBe(true);
  });

  it('usa el reloj de la API (hora de Lima) y sigue sus cambios', () => {
    const { reloj, horario } = servicio('2026-10-30T17:59:00-05:00');
    const trabajador = { esAdministrador: false, horario: viernesNoche };
    expect(horario.estaDentro(trabajador)).toBe(false);
    reloj.avanzar(60_000); // 18:00
    expect(horario.estaDentro(trabajador)).toBe(true);
    reloj.fijar('2026-10-31T01:59:00-05:00');
    expect(horario.estaDentro(trabajador)).toBe(true);
    reloj.fijar('2026-10-31T02:00:00-05:00');
    expect(horario.estaDentro(trabajador)).toBe(false);
  });

  it('acepta un instante explícito en lugar del reloj', () => {
    const { horario } = servicio('2026-11-02T10:00:00-05:00');
    const trabajador = { esAdministrador: false, horario: viernesNoche };
    expect(horario.estaDentro(trabajador, new Date('2026-10-31T06:59:00Z'))).toBe(true);
    expect(horario.estaDentro(trabajador, new Date('2026-10-31T07:00:00Z'))).toBe(false);
  });

  it('no depende de la zona horaria del proceso', () => {
    const original = process.env.TZ;
    try {
      for (const zona of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
        process.env.TZ = zona;
        const { horario } = servicio('2026-10-30T18:00:00-05:00');
        expect(horario.estaDentro({ esAdministrador: false, horario: viernesNoche }), zona).toBe(
          true,
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('un horario guardado que no se puede leer deja fuera (falla cerrada)', () => {
    const { horario } = servicio('2026-10-30T18:30:00-05:00');
    for (const roto of [
      [],
      'texto',
      42,
      [{ dia: 9, desde: '18:00', hasta: '02:00' }],
      [{ dia: 5, desde: '25:00', hasta: '02:00' }],
      [{ dia: 5, desde: '18:00', hasta: '18:00' }],
      [
        { dia: 5, desde: '10:00', hasta: '14:00' },
        { dia: 5, desde: '12:00', hasta: '16:00' },
      ],
    ]) {
      expect(
        horario.estaDentro({ esAdministrador: false, horario: roto }),
        JSON.stringify(roto),
      ).toBe(false);
    }
  });
});

describe('HorarioService.validar y tramosDe', () => {
  const { horario } = servicio('2026-11-02T10:00:00-05:00');

  it('valida un horario: lista de al menos un tramo sin solapes, o null', () => {
    expect(horario.validar(null)).toEqual({ valido: true, horario: null });
    expect(horario.validar(viernesNoche)).toEqual({ valido: true, horario: viernesNoche });
    for (const malo of [
      [],
      [{ dia: 1, desde: '09:00', hasta: '09:00' }],
      [
        { dia: 2, desde: '09:00', hasta: '12:00' },
        { dia: 2, desde: '11:00', hasta: '13:00' },
      ],
      'no es un horario',
    ]) {
      const resultado = horario.validar(malo);
      expect(resultado.valido, JSON.stringify(malo)).toBe(false);
    }
  });

  it('tramosDe devuelve null sin horario y undefined si lo guardado no es un horario', () => {
    expect(horario.tramosDe(null)).toBeNull();
    expect(horario.tramosDe(undefined)).toBeNull();
    expect(horario.tramosDe(viernesNoche)).toEqual(viernesNoche);
    expect(horario.tramosDe([])).toBeUndefined();
    expect(horario.tramosDe({ dia: 1 })).toBeUndefined();
  });
});
