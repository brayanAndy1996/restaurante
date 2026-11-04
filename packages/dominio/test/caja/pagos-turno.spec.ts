// spec: 006-caja-cobro (pruebas protegidas)
//
// P1 · Criterios 8, 21 y 22 (reglas puras de montos): `validarPagos`, `redondeoEfectivo`, `esperadoDelTurno` y
// `diferenciasDelArqueo`. Cada ejemplo de la especificación, el caso del redondeo sin efectivo
// (total 20.05 con Yape 20.00 y redondeo 0.05 → PAGOS_NO_CUADRAN) y los montos mal formados del criterio 8.
import { describe, expect, it } from 'vitest';
import {
  MEDIOS_PAGO,
  diferenciasDelArqueo,
  esperadoDelTurno,
  redondeoEfectivo,
  validarPagos,
  type MedioPago,
  type MontoPorMedio,
} from '../../src';

const noCuadra = { valido: false, codigo: 'PAGOS_NO_CUADRAN' } as const;

describe('redondeoEfectivo · criterio 21', () => {
  it('todo en efectivo, 33.34: se deja de cobrar 0.04 (a la décima hacia abajo)', () => {
    expect(redondeoEfectivo('33.34', []).redondeo).toBe('0.04');
  });

  it('con Yape de 20.00 y total 34.60 el efectivo es 14.60 y el redondeo 0.00', () => {
    expect(redondeoEfectivo('34.60', [{ monto: '20.00' }]).redondeo).toBe('0.00');
  });

  it('total 69.20 todo con tarjeta: el efectivo es 0.00 y el redondeo 0.00', () => {
    expect(redondeoEfectivo('69.20', [{ monto: '69.20' }]).redondeo).toBe('0.00');
  });

  it('el redondeo es solo de la parte en efectivo: 50.07 con Yape de 20.00 deja 0.07', () => {
    expect(redondeoEfectivo('50.07', [{ monto: '20.00' }]).redondeo).toBe('0.07');
  });

  it.each([
    ['0.04', '0.04'],
    ['10.09', '0.09'],
    ['10.10', '0.00'],
    ['10.01', '0.01'],
    ['10.05', '0.05'],
    ['33.30', '0.00'],
    ['0.00', '0.00'],
  ])('todo en efectivo, total %s: redondeo %s (de 0.00 a 0.09)', (total, redondeo) => {
    expect(redondeoEfectivo(total, []).redondeo).toBe(redondeo);
  });

  it('suma varios pagos que no son efectivo', () => {
    expect(
      redondeoEfectivo('100.07', [{ monto: '30.00' }, { monto: '20.00' }]).redondeo,
    ).toBe('0.07');
  });

  it('rechaza montos mal formados con RangeError (criterio 8)', () => {
    expect(() => redondeoEfectivo('abc', [])).toThrow(RangeError);
    expect(() => redondeoEfectivo('10.001', [])).toThrow(RangeError);
    expect(() => redondeoEfectivo('10.00', [{ monto: '-1.00' }])).toThrow(RangeError);
    expect(() => redondeoEfectivo(10 as unknown as string, [])).toThrow(RangeError);
  });
});

describe('validarPagos · ejemplos del criterio 21', () => {
  it('total 33.34 todo en efectivo: redondeo 0.04, efectivo 33.30, recibido 50.00, vuelto 16.70', () => {
    expect(
      validarPagos('33.34', [{ medio: 'EFECTIVO', monto: '33.30', recibido: '50.00' }], '0.04'),
    ).toEqual({ valido: true, vuelto: '16.70' });
  });

  it('total 34.60 con Yape 20.00: efectivo 14.60, redondeo 0.00, sin vuelto', () => {
    expect(
      validarPagos(
        '34.60',
        [
          { medio: 'EFECTIVO', monto: '14.60' },
          { medio: 'YAPE', monto: '20.00' },
        ],
        '0.00',
      ),
    ).toEqual({ valido: true, vuelto: '0.00' });
  });

  it('total 69.20 todo con tarjeta: redondeo 0.00', () => {
    expect(validarPagos('69.20', [{ medio: 'TARJETA_CREDITO', monto: '69.20' }], '0.00')).toEqual({
      valido: true,
      vuelto: '0.00',
    });
  });

  it('la suma que no cuadra por un céntimo es PAGOS_NO_CUADRAN', () => {
    expect(validarPagos('69.20', [{ medio: 'TARJETA_CREDITO', monto: '69.19' }], '0.00')).toEqual(noCuadra);
    expect(validarPagos('69.20', [{ medio: 'TARJETA_CREDITO', monto: '69.21' }], '0.00')).toEqual(noCuadra);
  });

  it('vuelto con tarjeta (un monto mayor que el total) es PAGOS_NO_CUADRAN', () => {
    expect(validarPagos('69.20', [{ medio: 'TARJETA_DEBITO', monto: '100.00' }], '0.00')).toEqual(noCuadra);
  });

  it('recibido solo existe en el efectivo: con tarjeta es PAGOS_NO_CUADRAN', () => {
    expect(
      validarPagos('69.20', [{ medio: 'TARJETA_CREDITO', monto: '69.20', recibido: '100.00' }], '0.00'),
    ).toEqual(noCuadra);
    expect(validarPagos('20.00', [{ medio: 'YAPE', monto: '20.00', recibido: '20.00' }], '0.00')).toEqual(noCuadra);
  });

  it('total 20.05 con Yape 20.00 y redondeo 0.05 sin efectivo: PAGOS_NO_CUADRAN', () => {
    expect(validarPagos('20.05', [{ medio: 'YAPE', monto: '20.00' }], '0.05')).toEqual(noCuadra);
  });

  it('sin efectivo el redondeo es siempre 0.00: 20.05 se paga completo con Yape', () => {
    expect(validarPagos('20.05', [{ medio: 'YAPE', monto: '20.05' }], '0.00')).toEqual({
      valido: true,
      vuelto: '0.00',
    });
    expect(validarPagos('20.05', [{ medio: 'YAPE', monto: '20.00' }], '0.00')).toEqual(noCuadra);
  });
});

describe('validarPagos · reglas de cada pago y del redondeo', () => {
  it('el redondeo debe ser exactamente el de redondeoEfectivo: uno inventado o ausente no cuadra', () => {
    expect(validarPagos('33.34', [{ medio: 'EFECTIVO', monto: '33.34' }], '0.00')).toEqual(noCuadra);
    expect(validarPagos('33.34', [{ medio: 'EFECTIVO', monto: '33.20' }], '0.14')).toEqual(noCuadra);
    expect(validarPagos('33.34', [{ medio: 'EFECTIVO', monto: '33.30' }], '0.04')).toEqual({
      valido: true,
      vuelto: '0.00',
    });
  });

  it('el redondeo no se suma dos veces: monto 33.34 más redondeo 0.04 no cuadra con 33.34', () => {
    expect(validarPagos('33.34', [{ medio: 'EFECTIVO', monto: '33.34' }], '0.04')).toEqual(noCuadra);
  });

  it('el redondeo solo toca el efectivo: total 50.07 con Yape 20.00 y efectivo 30.00, redondeo 0.07, vuelto 20.00', () => {
    expect(
      validarPagos(
        '50.07',
        [
          { medio: 'YAPE', monto: '20.00' },
          { medio: 'EFECTIVO', monto: '30.00', recibido: '50.00' },
        ],
        '0.07',
      ),
    ).toEqual({ valido: true, vuelto: '20.00' });
  });

  it('el vuelto es recibido menos el monto del efectivo, aunque haya otros medios', () => {
    expect(
      validarPagos(
        '34.60',
        [
          { medio: 'EFECTIVO', monto: '14.60', recibido: '20.00' },
          { medio: 'YAPE', monto: '20.00' },
        ],
        '0.00',
      ),
    ).toEqual({ valido: true, vuelto: '5.40' });
  });

  it('si falta el recibido vale el monto: vuelto 0.00', () => {
    expect(validarPagos('10.00', [{ medio: 'EFECTIVO', monto: '10.00' }], '0.00')).toEqual({
      valido: true,
      vuelto: '0.00',
    });
  });

  it('el recibido menor que el monto no cuadra', () => {
    expect(
      validarPagos('10.00', [{ medio: 'EFECTIVO', monto: '10.00', recibido: '9.00' }], '0.00'),
    ).toEqual(noCuadra);
  });

  it('a lo más un pago en efectivo', () => {
    expect(
      validarPagos(
        '10.00',
        [
          { medio: 'EFECTIVO', monto: '5.00' },
          { medio: 'EFECTIVO', monto: '5.00' },
        ],
        '0.00',
      ),
    ).toEqual(noCuadra);
  });

  it('cada monto debe ser mayor que cero', () => {
    expect(
      validarPagos(
        '10.00',
        [
          { medio: 'YAPE', monto: '0.00' },
          { medio: 'TARJETA_CREDITO', monto: '10.00' },
        ],
        '0.00',
      ),
    ).toEqual(noCuadra);
  });

  it('admite varios medios distintos al efectivo y dos pagos con el mismo medio no efectivo', () => {
    expect(
      validarPagos(
        '30.00',
        [
          { medio: 'YAPE', monto: '10.00' },
          { medio: 'PLIN', monto: '10.00' },
          { medio: 'TARJETA_DEBITO', monto: '10.00' },
        ],
        '0.00',
      ),
    ).toEqual({ valido: true, vuelto: '0.00' });
    expect(
      validarPagos(
        '30.00',
        [
          { medio: 'TARJETA_CREDITO', monto: '10.00' },
          { medio: 'TARJETA_CREDITO', monto: '20.00' },
        ],
        '0.00',
      ),
    ).toEqual({ valido: true, vuelto: '0.00' });
  });

  it('un total de 0.00 (solo cortesías) se cobra sin pagos', () => {
    expect(validarPagos('0.00', [], '0.00')).toEqual({ valido: true, vuelto: '0.00' });
  });

  it('sin pagos y con total mayor que cero no cuadra', () => {
    expect(validarPagos('10.00', [], '0.00')).toEqual(noCuadra);
  });

  it('rechaza montos mal formados con RangeError (criterio 8)', () => {
    expect(() => validarPagos('abc', [], '0.00')).toThrow(RangeError);
    expect(() => validarPagos('10.00', [{ medio: 'YAPE', monto: '10.001' }], '0.00')).toThrow(RangeError);
    expect(() => validarPagos('10.00', [{ medio: 'YAPE', monto: '-10.00' }], '0.00')).toThrow(RangeError);
    expect(() => validarPagos('10.00', [{ medio: 'YAPE', monto: '10.00' }], 'x')).toThrow(RangeError);
    expect(() =>
      validarPagos('10.00', [{ medio: 'EFECTIVO', monto: '10.00', recibido: '1e2' }], '0.00'),
    ).toThrow(RangeError);
    expect(() => validarPagos(10 as unknown as string, [], '0.00')).toThrow(RangeError);
  });
});

describe('esperadoDelTurno · criterio 22', () => {
  const monto = (esperado: readonly MontoPorMedio[], medio: MedioPago): string =>
    esperado.find((e) => e.medio === medio)!.monto;

  it('el ejemplo: fondo 200.00, efectivo 33.30 y 50.00, Yape 34.60, ingreso 20.00 y egreso 15.50', () => {
    const esperado = esperadoDelTurno({
      fondo: '200.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '33.30' },
        { medio: 'EFECTIVO', monto: '50.00' },
        { medio: 'YAPE', monto: '34.60' },
      ],
      movimientos: [
        { tipo: 'INGRESO', monto: '20.00' },
        { tipo: 'EGRESO', monto: '15.50' },
      ],
    });
    expect(esperado).toEqual([
      { medio: 'EFECTIVO', monto: '287.80' },
      { medio: 'TARJETA_CREDITO', monto: '0.00' },
      { medio: 'TARJETA_DEBITO', monto: '0.00' },
      { medio: 'YAPE', monto: '34.60' },
      { medio: 'PLIN', monto: '0.00' },
    ]);
  });

  it('devuelve los cinco medios en el orden de MEDIOS_PAGO', () => {
    const esperado = esperadoDelTurno({ fondo: '0.00', pagos: [], movimientos: [] });
    expect(esperado.map((e) => e.medio)).toEqual([...MEDIOS_PAGO]);
    expect(esperado.every((e) => e.monto === '0.00')).toBe(true);
  });

  it('sin importar el orden de los pagos de entrada', () => {
    const esperado = esperadoDelTurno({
      fondo: '10.00',
      pagos: [
        { medio: 'PLIN', monto: '5.00' },
        { medio: 'YAPE', monto: '7.00' },
        { medio: 'EFECTIVO', monto: '1.00' },
      ],
      movimientos: [],
    });
    expect(esperado.map((e) => e.medio)).toEqual([...MEDIOS_PAGO]);
    expect(monto(esperado, 'EFECTIVO')).toBe('11.00');
    expect(monto(esperado, 'PLIN')).toBe('5.00');
    expect(monto(esperado, 'YAPE')).toBe('7.00');
  });

  it('suma los pagos de un mismo medio no efectivo', () => {
    const esperado = esperadoDelTurno({
      fondo: '0.00',
      pagos: [
        { medio: 'TARJETA_CREDITO', monto: '10.10' },
        { medio: 'TARJETA_CREDITO', monto: '0.20' },
        { medio: 'TARJETA_DEBITO', monto: '3.33' },
      ],
      movimientos: [],
    });
    expect(monto(esperado, 'TARJETA_CREDITO')).toBe('10.30');
    expect(monto(esperado, 'TARJETA_DEBITO')).toBe('3.33');
  });

  it('los ingresos y egresos son siempre de efectivo y no tocan los otros medios', () => {
    const esperado = esperadoDelTurno({
      fondo: '100.00',
      pagos: [{ medio: 'YAPE', monto: '10.00' }],
      movimientos: [
        { tipo: 'INGRESO', monto: '5.00' },
        { tipo: 'EGRESO', monto: '30.00' },
      ],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('75.00');
    expect(monto(esperado, 'YAPE')).toBe('10.00');
  });

  it('un egreso puede dejar el efectivo esperado en negativo', () => {
    const esperado = esperadoDelTurno({
      fondo: '0.00',
      pagos: [],
      movimientos: [{ tipo: 'EGRESO', monto: '10.00' }],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('-10.00');
  });

  it('suma con decimales exactos (0.10 + 0.20 = 0.30)', () => {
    const esperado = esperadoDelTurno({
      fondo: '0.00',
      pagos: [
        { medio: 'EFECTIVO', monto: '0.10' },
        { medio: 'EFECTIVO', monto: '0.20' },
      ],
      movimientos: [],
    });
    expect(monto(esperado, 'EFECTIVO')).toBe('0.30');
  });

  it('rechaza montos mal formados con RangeError (criterio 8)', () => {
    expect(() => esperadoDelTurno({ fondo: 'abc', pagos: [], movimientos: [] })).toThrow(RangeError);
    expect(() =>
      esperadoDelTurno({ fondo: '0.00', pagos: [{ medio: 'YAPE', monto: '1.234' }], movimientos: [] }),
    ).toThrow(RangeError);
    expect(() =>
      esperadoDelTurno({ fondo: '0.00', pagos: [], movimientos: [{ tipo: 'INGRESO', monto: '-5.00' }] }),
    ).toThrow(RangeError);
  });
});

describe('diferenciasDelArqueo · criterio 22', () => {
  const esperadoEjemplo = (): MontoPorMedio[] => [
    { medio: 'EFECTIVO', monto: '287.80' },
    { medio: 'TARJETA_CREDITO', monto: '0.00' },
    { medio: 'TARJETA_DEBITO', monto: '0.00' },
    { medio: 'YAPE', monto: '34.60' },
    { medio: 'PLIN', monto: '0.00' },
  ];

  it('contado efectivo 287.00 contra 287.80 esperado: diferencia -0.80', () => {
    const r = diferenciasDelArqueo(esperadoEjemplo(), [
      { medio: 'EFECTIVO', monto: '287.00' },
      { medio: 'TARJETA_CREDITO', monto: '0.00' },
      { medio: 'TARJETA_DEBITO', monto: '0.00' },
      { medio: 'YAPE', monto: '34.60' },
      { medio: 'PLIN', monto: '0.00' },
    ]);
    expect(r).toEqual([
      { medio: 'EFECTIVO', esperado: '287.80', contado: '287.00', diferencia: '-0.80' },
      { medio: 'TARJETA_CREDITO', esperado: '0.00', contado: '0.00', diferencia: '0.00' },
      { medio: 'TARJETA_DEBITO', esperado: '0.00', contado: '0.00', diferencia: '0.00' },
      { medio: 'YAPE', esperado: '34.60', contado: '34.60', diferencia: '0.00' },
      { medio: 'PLIN', esperado: '0.00', contado: '0.00', diferencia: '0.00' },
    ]);
  });

  it('un sobrante da diferencia positiva (contado menos esperado)', () => {
    const r = diferenciasDelArqueo(esperadoEjemplo(), [
      { medio: 'EFECTIVO', monto: '287.80' },
      { medio: 'TARJETA_CREDITO', monto: '1.00' },
      { medio: 'TARJETA_DEBITO', monto: '0.00' },
      { medio: 'YAPE', monto: '35.00' },
      { medio: 'PLIN', monto: '0.00' },
    ]);
    expect(r.map((x) => x.diferencia)).toEqual(['0.00', '1.00', '0.00', '0.40', '0.00']);
  });

  it('con esperado negativo la diferencia sigue siendo contado − esperado', () => {
    const r = diferenciasDelArqueo(
      [
        { medio: 'EFECTIVO', monto: '-10.00' },
        { medio: 'TARJETA_CREDITO', monto: '0.00' },
        { medio: 'TARJETA_DEBITO', monto: '0.00' },
        { medio: 'YAPE', monto: '0.00' },
        { medio: 'PLIN', monto: '0.00' },
      ],
      MEDIOS_PAGO.map((medio) => ({ medio, monto: '0.00' })),
    );
    expect(r[0]).toEqual({ medio: 'EFECTIVO', esperado: '-10.00', contado: '0.00', diferencia: '10.00' });
  });

  it('rechaza montos mal formados con RangeError (criterio 8)', () => {
    expect(() =>
      diferenciasDelArqueo(esperadoEjemplo(), MEDIOS_PAGO.map((medio) => ({ medio, monto: 'x' }))),
    ).toThrow(RangeError);
  });
});
