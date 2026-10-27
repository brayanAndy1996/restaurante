import { describe, expect, it } from 'vitest';
import { validarHorario } from '../src';

describe('validarHorario', () => {
  it('acepta la lista vacía', () => {
    expect(validarHorario([])).toEqual({ valido: true });
  });

  it('acepta varios tramos el mismo día sin solaparse', () => {
    const r = validarHorario([
      { dia: 1, desde: '12:00', hasta: '15:00' },
      { dia: 1, desde: '19:00', hasta: '23:00' },
    ]);
    expect(r.valido).toBe(true);
  });

  it('acepta tramos contiguos (uno termina cuando empieza el otro)', () => {
    const r = validarHorario([
      { dia: 2, desde: '10:00', hasta: '14:00' },
      { dia: 2, desde: '14:00', hasta: '18:00' },
    ]);
    expect(r.valido).toBe(true);
  });

  it('acepta un tramo que cruza la medianoche', () => {
    expect(validarHorario([{ dia: 5, desde: '18:00', hasta: '02:00' }]).valido).toBe(true);
  });

  it('acepta el domingo cruzando hacia el lunes', () => {
    const r = validarHorario([
      { dia: 7, desde: '20:00', hasta: '01:00' },
      { dia: 1, desde: '12:00', hasta: '16:00' },
    ]);
    expect(r.valido).toBe(true);
  });

  it('rechaza desde igual a hasta', () => {
    const r = validarHorario([{ dia: 1, desde: '10:00', hasta: '10:00' }]);
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.errores[0]?.indice).toBe(0);
  });

  it('rechaza tramos solapados el mismo día', () => {
    const r = validarHorario([
      { dia: 3, desde: '10:00', hasta: '15:00' },
      { dia: 3, desde: '14:00', hasta: '20:00' },
    ]);
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.errores[0]?.indice).toBe(1);
  });

  it('rechaza el solapamiento entre un tramo nocturno y el día siguiente', () => {
    const r = validarHorario([
      { dia: 5, desde: '18:00', hasta: '02:00' },
      { dia: 6, desde: '01:00', hasta: '05:00' },
    ]);
    expect(r.valido).toBe(false);
  });

  it('rechaza el solapamiento entre el domingo nocturno y el lunes', () => {
    const r = validarHorario([
      { dia: 7, desde: '22:00', hasta: '03:00' },
      { dia: 1, desde: '02:00', hasta: '06:00' },
    ]);
    expect(r.valido).toBe(false);
  });

  it('rechaza días fuera de 1 a 7 y horas mal formadas', () => {
    expect(validarHorario([{ dia: 0, desde: '10:00', hasta: '12:00' }]).valido).toBe(false);
    expect(validarHorario([{ dia: 8, desde: '10:00', hasta: '12:00' }]).valido).toBe(false);
    expect(validarHorario([{ dia: 1.5, desde: '10:00', hasta: '12:00' }]).valido).toBe(false);
    expect(validarHorario([{ dia: 1, desde: '25:00', hasta: '12:00' }]).valido).toBe(false);
    expect(validarHorario([{ dia: 1, desde: '10:00', hasta: '12' }]).valido).toBe(false);
  });
});
