import { describe, expect, it } from 'vitest';
import { diaOperativo } from '../src';

describe('diaOperativo', () => {
  it('antes de la hora de corte cuenta para el día anterior', () => {
    expect(diaOperativo(new Date('2026-03-10T03:00:00-05:00'), '05:00')).toBe('2026-03-09');
  });

  it('a la hora exacta de corte empieza el nuevo día', () => {
    expect(diaOperativo(new Date('2026-03-10T05:00:00-05:00'), '05:00')).toBe('2026-03-10');
    expect(diaOperativo(new Date('2026-03-10T04:59:59-05:00'), '05:00')).toBe('2026-03-09');
  });

  it('cruza el cambio de año', () => {
    expect(diaOperativo(new Date('2026-01-01T02:00:00-05:00'), '05:00')).toBe('2025-12-31');
  });

  it('con corte 00:00 da la fecha calendario de Lima', () => {
    expect(diaOperativo(new Date('2026-03-10T00:00:00-05:00'), '00:00')).toBe('2026-03-10');
    expect(diaOperativo(new Date('2026-03-10T23:59:59-05:00'), '00:00')).toBe('2026-03-10');
    expect(diaOperativo(new Date('2026-03-10T03:00:00-05:00'), '00:00')).toBe('2026-03-10');
  });

  it('usa la hora de Lima y no la del servidor (UTC)', () => {
    // 2026-03-10T02:00Z es el 9 de marzo a las 21:00 en Lima
    expect(diaOperativo(new Date('2026-03-10T02:00:00Z'), '00:00')).toBe('2026-03-09');
  });

  it('respeta cortes que no son horas en punto', () => {
    expect(diaOperativo(new Date('2026-03-10T05:29:00-05:00'), '05:30')).toBe('2026-03-09');
    expect(diaOperativo(new Date('2026-03-10T05:30:00-05:00'), '05:30')).toBe('2026-03-10');
  });

  it('rechaza horas de corte mal formadas', () => {
    expect(() => diaOperativo(new Date(), '5:00')).toThrow(RangeError);
    expect(() => diaOperativo(new Date(), '24:00')).toThrow(RangeError);
    expect(() => diaOperativo(new Date(), '')).toThrow(RangeError);
  });

  it('rechaza instantes inválidos', () => {
    expect(() => diaOperativo(new Date('no es fecha'), '05:00')).toThrow(RangeError);
  });
});
