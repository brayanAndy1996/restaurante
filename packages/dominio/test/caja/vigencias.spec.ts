// spec: 006-caja-cobro (pruebas protegidas)
//
// P1 · Criterios 8 y 10 (reglas puras de montos): `tasaIgvVigente` y `montoIcbperVigente`. Bordes de vigencia
// (el día anterior y el mismo día del `desde`), ausencia de tasa, tabla `MONTOS_ICBPER` y fechas mal formadas.
import { describe, expect, it } from 'vitest';
import { MONTOS_ICBPER, montoIcbperVigente, tasaIgvVigente } from '../../src';

describe('tasaIgvVigente · criterio 10', () => {
  const unaTasa = [{ desde: '2026-01-01', tasa: '18.00' }];

  it('el mismo día del desde ya rige', () => {
    expect(tasaIgvVigente(unaTasa, '2026-01-01')).toBe('18.00');
  });

  it('el día anterior al desde todavía no rige: null', () => {
    expect(tasaIgvVigente(unaTasa, '2025-12-31')).toBeNull();
  });

  it('después del desde sigue rigiendo', () => {
    expect(tasaIgvVigente(unaTasa, '2026-11-04')).toBe('18.00');
    expect(tasaIgvVigente(unaTasa, '2099-12-31')).toBe('18.00');
  });

  it('sin ninguna tasa devuelve null', () => {
    expect(tasaIgvVigente([], '2026-11-04')).toBeNull();
  });

  describe('con varias tasas', () => {
    const tasas = [
      { desde: '2024-01-01', tasa: '18.00' },
      { desde: '2026-07-01', tasa: '17.00' },
      { desde: '2027-01-01', tasa: '16.00' },
    ];

    it.each([
      ['2023-12-31', null],
      ['2024-01-01', '18.00'],
      ['2026-06-30', '18.00'],
      ['2026-07-01', '17.00'],
      ['2026-12-31', '17.00'],
      ['2027-01-01', '16.00'],
      ['2030-05-05', '16.00'],
    ])('el %s rige %j (el mayor desde menor o igual que la fecha)', (fecha, esperada) => {
      expect(tasaIgvVigente(tasas, fecha)).toBe(esperada);
    });

    it('no depende del orden en que vengan las tasas', () => {
      const desordenadas = [tasas[2]!, tasas[0]!, tasas[1]!];
      expect(tasaIgvVigente(desordenadas, '2026-07-01')).toBe('17.00');
      expect(tasaIgvVigente(desordenadas, '2026-06-30')).toBe('18.00');
      expect(tasaIgvVigente(desordenadas, '2023-12-31')).toBeNull();
    });
  });

  it.each(['2026-1-1', '2026/01/01', '01-01-2026', '20260101', 'hoy', '', '2026-01-01T00:00:00'])(
    'rechaza la fecha %j con RangeError (criterio 8)',
    (fecha) => {
      expect(() => tasaIgvVigente(unaTasa, fecha)).toThrow(RangeError);
    },
  );

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-02-29', '2026-01-00'])(
    'rechaza la fecha inexistente en el calendario %j con RangeError',
    (fecha) => {
      expect(() => tasaIgvVigente(unaTasa, fecha)).toThrow(RangeError);
    },
  );

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(tasaIgvVigente(unaTasa, '2028-02-29')).toBe('18.00');
  });

  it('rechaza una fecha desde inexistente en el calendario con RangeError', () => {
    expect(() => tasaIgvVigente([{ desde: '2026-02-30', tasa: '18.00' }], '2026-06-01')).toThrow(
      RangeError,
    );
  });

  it('rechaza una fecha que no es texto con RangeError', () => {
    expect(() => tasaIgvVigente(unaTasa, 20260101 as unknown as string)).toThrow(RangeError);
  });

  it.each(['0.00', '30.01', 'abc'])('rechaza una tasa vigente de %j con RangeError', (tasa) => {
    expect(() => tasaIgvVigente([{ desde: '2026-01-01', tasa }], '2026-06-01')).toThrow(RangeError);
  });

  it('rechaza una fecha desde mal formada con RangeError', () => {
    expect(() => tasaIgvVigente([{ desde: '1/1/2026', tasa: '18.00' }], '2026-06-01')).toThrow(
      RangeError,
    );
  });
});

describe('montoIcbperVigente · criterio 10', () => {
  it('"0.50" desde 2023-01-01 (pregunta 5)', () => {
    expect(montoIcbperVigente('2023-01-01')).toBe('0.50');
    expect(montoIcbperVigente('2023-06-15')).toBe('0.50');
    expect(montoIcbperVigente('2026-11-04')).toBe('0.50');
    expect(montoIcbperVigente('2099-12-31')).toBe('0.50');
  });

  it('antes de la primera fecha lanza RangeError', () => {
    expect(() => montoIcbperVigente('2022-12-31')).toThrow(RangeError);
    expect(() => montoIcbperVigente('2000-01-01')).toThrow(RangeError);
  });

  it('cada fila de MONTOS_ICBPER rige desde su fecha, y el día anterior rige la fila previa o RangeError', () => {
    MONTOS_ICBPER.forEach((fila, i) => {
      expect(montoIcbperVigente(fila.desde)).toBe(fila.monto);
      const anterior = new Date(`${fila.desde}T00:00:00Z`);
      anterior.setUTCDate(anterior.getUTCDate() - 1);
      const dia = anterior.toISOString().slice(0, 10);
      if (i === 0) expect(() => montoIcbperVigente(dia)).toThrow(RangeError);
      else expect(montoIcbperVigente(dia)).toBe(MONTOS_ICBPER[i - 1]!.monto);
    });
  });

  it.each(['2026-1-1', '2026/01/01', '01-01-2026', '20260101', 'hoy', ''])(
    'rechaza la fecha %j con RangeError (criterio 8)',
    (fecha) => {
      expect(() => montoIcbperVigente(fecha)).toThrow(RangeError);
    },
  );
});

describe('montoIcbperVigente · fechas inexistentes (criterio 8)', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-02-29'])(
    'rechaza %j con RangeError',
    (fecha) => {
      expect(() => montoIcbperVigente(fecha)).toThrow(RangeError);
    },
  );

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(montoIcbperVigente('2028-02-29')).toBe('0.50');
  });
});
