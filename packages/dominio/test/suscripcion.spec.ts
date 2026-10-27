import { describe, expect, it } from 'vitest';
import { estadoSuscripcion, fechaLima, periodoLima, sumarMeses } from '../src';

// Criterios 71 y 72 de specs/002-plataforma-y-acceso (no es ruta crítica: prueba del desarrollador).

describe('fechaLima y periodoLima', () => {
  it('convierte a la fecha de Lima (UTC−5)', () => {
    expect(fechaLima(new Date('2026-11-10T23:59:59-05:00'))).toBe('2026-11-10');
    expect(fechaLima(new Date('2026-11-11T00:00:00-05:00'))).toBe('2026-11-11');
    expect(fechaLima(new Date('2026-11-11T04:59:59Z'))).toBe('2026-11-10');
    expect(fechaLima(new Date('2026-11-11T05:00:00Z'))).toBe('2026-11-11');
  });

  it('el periodo es el mes de Lima, también en el cambio de mes y de año', () => {
    expect(periodoLima(new Date('2026-11-30T23:59:59-05:00'))).toBe('2026-11');
    expect(periodoLima(new Date('2026-12-01T04:59:59Z'))).toBe('2026-11');
    expect(periodoLima(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12');
    expect(periodoLima(new Date('2027-01-01T04:59:59Z'))).toBe('2026-12');
    expect(periodoLima(new Date('2027-01-01T05:00:00Z'))).toBe('2027-01');
  });

  it('no depende de la zona horaria del proceso', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Lima', 'Pacific/Auckland']) {
        process.env.TZ = tz;
        expect(fechaLima(new Date('2026-11-11T04:59:59Z')), tz).toBe('2026-11-10');
        expect(fechaLima(new Date('2026-11-11T05:00:00Z')), tz).toBe('2026-11-11');
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('rechaza un instante inválido', () => {
    expect(() => fechaLima(new Date('no es una fecha'))).toThrow(RangeError);
  });
});

describe('sumarMeses', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-11-10', 0, '2026-11-10'],
    ['2026-11-10', 12, '2027-11-10'],
    ['2026-11-10', 14, '2028-01-10'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-01-15', -2, '2025-11-15'],
  ])('%s + %i meses = %s', (fecha, n, esperado) => {
    expect(sumarMeses(fecha, n)).toBe(esperado);
  });

  it('rechaza fechas mal formadas o inexistentes y cantidades no enteras', () => {
    for (const mala of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', 'hoy']) {
      expect(() => sumarMeses(mala, 1), mala).toThrow(RangeError);
    }
    expect(() => sumarMeses('2026-01-01', 1.5)).toThrow(RangeError);
  });
});

describe('estadoSuscripcion', () => {
  const datos = { vencimiento: '2026-11-10', diasGracia: 7 };

  it('ACTIVA hasta el final del día del vencimiento', () => {
    expect(estadoSuscripcion(datos, new Date('2026-11-10T23:59:00-05:00'))).toEqual({
      estado: 'ACTIVA',
      suspensionDesde: '2026-11-18',
      diasRestantesGracia: null,
    });
    expect(estadoSuscripcion(datos, new Date('2026-10-01T12:00:00-05:00')).estado).toBe('ACTIVA');
  });

  it('EN_GRACIA desde el día siguiente, con los días que quedan', () => {
    expect(estadoSuscripcion(datos, new Date('2026-11-11T00:00:00-05:00'))).toEqual({
      estado: 'EN_GRACIA',
      suspensionDesde: '2026-11-18',
      diasRestantesGracia: 7,
    });
    expect(estadoSuscripcion(datos, new Date('2026-11-17T12:00:00-05:00'))).toEqual({
      estado: 'EN_GRACIA',
      suspensionDesde: '2026-11-18',
      diasRestantesGracia: 1,
    });
  });

  it('SUSPENDIDA desde vencimiento + días de gracia + 1', () => {
    expect(estadoSuscripcion(datos, new Date('2026-11-18T00:00:00-05:00'))).toEqual({
      estado: 'SUSPENDIDA',
      suspensionDesde: '2026-11-18',
      diasRestantesGracia: null,
    });
    expect(estadoSuscripcion(datos, new Date('2027-05-01T12:00:00-05:00')).estado).toBe(
      'SUSPENDIDA',
    );
  });

  it('con 0 días de gracia pasa de ACTIVA a SUSPENDIDA al día siguiente', () => {
    const sinGracia = { vencimiento: '2026-11-10', diasGracia: 0 };
    expect(estadoSuscripcion(sinGracia, new Date('2026-11-10T23:59:00-05:00')).estado).toBe(
      'ACTIVA',
    );
    expect(estadoSuscripcion(sinGracia, new Date('2026-11-11T00:00:00-05:00'))).toEqual({
      estado: 'SUSPENDIDA',
      suspensionDesde: '2026-11-11',
      diasRestantesGracia: null,
    });
  });

  it('usa la hora de Lima y no la del servidor', () => {
    // 2026-11-11T03:00Z es todavía 2026-11-10 (22:00) en Lima: sigue ACTIVA.
    expect(estadoSuscripcion(datos, new Date('2026-11-11T03:00:00Z')).estado).toBe('ACTIVA');
    expect(estadoSuscripcion(datos, new Date('2026-11-11T05:00:00Z')).estado).toBe('EN_GRACIA');
  });

  it('rechaza datos inválidos', () => {
    expect(() =>
      estadoSuscripcion({ vencimiento: '2026-02-30', diasGracia: 7 }, new Date()),
    ).toThrow(RangeError);
    expect(() =>
      estadoSuscripcion({ vencimiento: '2026-11-10', diasGracia: -1 }, new Date()),
    ).toThrow(RangeError);
    expect(() =>
      estadoSuscripcion({ vencimiento: '2026-11-10', diasGracia: 1.5 }, new Date()),
    ).toThrow(RangeError);
  });
});
