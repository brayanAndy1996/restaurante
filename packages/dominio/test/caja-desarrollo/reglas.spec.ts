// Pruebas del desarrollador (no protegidas) · Criterios 8 a 22: casos que las pruebas protegidas de P1 no cubren
// (decisiones donde la especificación calla, bordes de cuentas pequeñas y propiedades entre funciones).
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  MEDIOS_PAGO,
  calcularCuenta,
  calcularParte,
  cambioDeCuentaPermitido,
  desglosar,
  diferenciasDelArqueo,
  esperadoDelTurno,
  redondeoEfectivo,
  repartirPorMayorResto,
  tasaIgvVigente,
  tiposDeComprobantePermitidos,
  validarDescuento,
  validarPagos,
  type ParteCalculada,
  type ParteEntrada,
  type PagoEntrada,
} from '../../src';
import {
  ID,
  cuentaC,
  desdeCentimos,
  entero,
  lineaBolsa,
  lineaGaseosa,
  lineaLomo,
  semilla,
  sumar,
  tomar,
} from '../caja/ayudas';

describe('validarDescuento · porcentaje sobre una base de 0.00', () => {
  // Decisión (spec, criterio 14): el paso (4) "monto 0.00 → DESCUENTO_NULO" va antes que el (5) "monto ≥ base";
  // con base 0.00 un porcentaje da monto 0.00 y por el orden literal es DESCUENTO_NULO. Un monto sí es EXCESIVO.
  it('un porcentaje sobre 0.00 es DESCUENTO_NULO (orden literal de los pasos)', () => {
    expect(validarDescuento('0.00', { tipo: 'PORCENTAJE', valor: '10' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_NULO',
    });
  });

  it('un porcentaje mayor que 99.99 sobre 0.00 es DESCUENTO_EXCESIVO (paso 1)', () => {
    expect(validarDescuento('0.00', { tipo: 'PORCENTAJE', valor: '100' })).toEqual({
      valido: false,
      codigo: 'DESCUENTO_EXCESIVO',
    });
  });

  it('acepta una base de hasta 12 enteros (un bruto de 999 unidades al mayor precio)', () => {
    expect(validarDescuento('99899999990.01', { tipo: 'MONTO', valor: '1.00' })).toEqual({
      valido: true,
      monto: '1.00',
    });
  });

  it('rechaza un tipo de descuento desconocido con RangeError', () => {
    expect(() =>
      validarDescuento('56.00', { tipo: 'OTRO', valor: '1.00' } as unknown as never),
    ).toThrow(RangeError);
  });
});

describe('calcularCuenta · descuentos que no caben', () => {
  it('un descuento de ítem mayor que su importe es RangeError (el neto no puede quedar negativo)', () => {
    expect(() =>
      calcularCuenta(
        cuentaC({
          lineas: [lineaLomo({ descuento: { tipo: 'MONTO', valor: '56.01' } }), lineaGaseosa()],
        }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      calcularCuenta(
        cuentaC({
          lineas: [lineaLomo({ descuento: { tipo: 'PORCENTAJE', valor: '101' } }), lineaGaseosa()],
        }),
      ),
    ).toThrow(RangeError);
  });

  it('un descuento de ítem igual a su importe deja la línea en cero', () => {
    const r = calcularCuenta(
      cuentaC({
        lineas: [lineaLomo({ descuento: { tipo: 'MONTO', valor: '56.00' } }), lineaGaseosa()],
      }),
    );
    expect(r.lineas[0]).toMatchObject({ neto: '0.00', base: '0.00', igv: '0.00' });
  });

  it('un descuento de la cuenta mayor que su importe es RangeError', () => {
    expect(() =>
      calcularCuenta(cuentaC({ descuentoCuenta: { tipo: 'MONTO', valor: '68.21' } })),
    ).toThrow(RangeError);
  });

  it('una cuenta sin líneas da todo en cero', () => {
    const r = calcularCuenta(cuentaC({ lineas: [] }));
    expect(r.lineas).toEqual([]);
    expect(r.totales.total).toBe('0.00');
    expect(r.totales.operaciones).toEqual({
      gravadas: '0.00',
      exoneradas: '0.00',
      inafectas: '0.00',
      gratuitas: '0.00',
    });
  });

  it('rechaza una afectación o un indicador de ICBPER que no existen con RangeError', () => {
    expect(() =>
      calcularCuenta(cuentaC({ lineas: [lineaLomo({ afectacion: 'X' as never })] })),
    ).toThrow(RangeError);
    expect(() =>
      calcularCuenta(cuentaC({ lineas: [lineaLomo({ aplicaIcbper: 1 as never })] })),
    ).toThrow(RangeError);
  });
});

describe('repartirPorMayorResto · propiedad', () => {
  it('la suma es siempre el monto, nunca hay un resultado negativo y uno de peso 0.00 recibe 0.00', () => {
    const rnd = semilla(0x510e527f);
    for (let i = 0; i < 500; i++) {
      const n = entero(rnd, 1, 6);
      const pesos: string[] = Array.from({ length: n }, () =>
        rnd() < 0.2 ? '0.00' : desdeCentimos(entero(rnd, 1, 100_000)),
      );
      if (!pesos.some((p) => p !== '0.00')) pesos[0] = '1.00';
      const total = desdeCentimos(entero(rnd, 0, 50_000));
      const r = repartirPorMayorResto(total, pesos);
      expect(r).toHaveLength(n);
      expect(sumar(r)).toBe(total);
      r.forEach((x, j) => {
        expect(new Decimal(x).gte(0)).toBe(true);
        if (pesos[j] === '0.00') expect(x).toBe('0.00');
      });
    }
  });

  it('repartir un monto positivo entre pesos que suman cero es RangeError', () => {
    expect(() => repartirPorMayorResto('1.00', ['0.00', '0.00'])).toThrow(RangeError);
  });
});

describe('desglosar · fidelidad con tasas distintas', () => {
  it('"0.03" con IGV de 20 % redondea la base a la mitad hacia arriba', () => {
    expect(desglosar('0.03', 'GRAVADO', '20.00')).toEqual({ base: '0.03', igv: '0.00' });
  });

  it('rechaza una afectación desconocida con RangeError', () => {
    expect(() => desglosar('1.00', 'X' as never, '18.00')).toThrow(RangeError);
  });
});

describe('tasaIgvVigente · normalización', () => {
  it('devuelve la tasa con 2 decimales aunque se haya guardado sin ellos', () => {
    expect(tasaIgvVigente([{ desde: '2026-01-01', tasa: '18' }], '2026-06-01')).toBe('18.00');
    expect(tasaIgvVigente([{ desde: '2026-01-01', tasa: '7.5' }], '2026-06-01')).toBe('7.50');
  });
});

describe('tiposDeComprobantePermitidos · régimen fuera del catálogo', () => {
  it('lanza RangeError', () => {
    expect(() => tiposDeComprobantePermitidos('OTRO' as never)).toThrow(RangeError);
  });
});

describe('calcularParte · partes iguales en casos de borde', () => {
  const iguales = (r: number): ParteEntrada => ({ tipo: 'IGUALES', partesRestantes: r });

  it('una cuenta solo de bolsas cuyo consumo sobraría por un céntimo no toma de más (se acota a lo que falta)', () => {
    // 3 bolsas a 0.11 con S/ 0.02 de descuento: neto 0.31 + ICBPER 1.50 = 1.81; en 3 partes la primera pide 0.61
    // pero la bolsa cuesta 0.10 + 0.50 y no queda consumo por cobrar
    const cuenta = cuentaC({
      lineas: [
        lineaBolsa({
          precioUnitario: '0.11',
          cantidad: 3,
          descuento: { tipo: 'MONTO', valor: '0.02' },
        }),
      ],
    });
    expect(calcularCuenta(cuenta).totales.total).toBe('1.81');
    const partes: ParteCalculada[] = [];
    for (const r of [3, 2, 1]) {
      partes.push(tomar(calcularParte(cuenta, partes, iguales(r), 'CONSUMO')));
    }
    expect(partes.map((p) => p.totales.total)).toEqual(['0.60', '0.61', '0.60']);
    expect(sumar(partes.map((p) => p.totales.total))).toBe('1.81');
    expect(partes.map((p) => p.cierraLaCuenta)).toEqual([false, false, true]);
  });

  it('en Nuevo RUS las partes iguales no llevan IGV ni operaciones', () => {
    const cuenta = cuentaC({ tasaIgv: null });
    const p1 = tomar(calcularParte(cuenta, [], iguales(2), 'CONSUMO'));
    const p2 = tomar(calcularParte(cuenta, [p1], iguales(1), 'CONSUMO'));
    for (const p of [p1, p2]) {
      expect(p.totales.operaciones).toBeNull();
      expect(p.totales.igv).toBe('0.00');
      expect(p.lineas.every((l) => l.igv === '0.00' && l.base === l.neto)).toBe(true);
    }
    expect(sumar([p1.totales.total, p2.totales.total])).toBe('69.20');
  });

  it('las cortesías van en la primera parte igual y no en las siguientes', () => {
    const cuenta = cuentaC({
      lineas: [lineaLomo(), lineaGaseosa({ cantidad: 2, cantidadCortesia: 1 })],
    });
    const p1 = tomar(calcularParte(cuenta, [], iguales(2), 'CONSUMO'));
    const p2 = tomar(calcularParte(cuenta, [p1], iguales(1), 'CONSUMO'));
    expect(p1.lineas.filter((l) => l.gratuita !== null)).toHaveLength(1);
    expect(p1.lineas[p1.lineas.length - 1]!.gratuita).toMatchObject({ valorReferencial: '9.00' });
    expect(p2.lineas.filter((l) => l.gratuita !== null)).toHaveLength(0);
    expect(p1.totales.operaciones?.gratuitas).toBe('7.63');
    expect(sumar([p1.totales.total, p2.totales.total])).toBe('65.00');
  });

  it('las bolsas se reparten enteras: 3 bolsas en 2 partes son 2 y 1', () => {
    const cuenta = cuentaC({ lineas: [lineaLomo(), lineaBolsa({ cantidad: 3 })] });
    const p1 = tomar(calcularParte(cuenta, [], iguales(2), 'CONSUMO'));
    const p2 = tomar(calcularParte(cuenta, [p1], iguales(1), 'CONSUMO'));
    expect(p1.porItem).toEqual([{ itemId: ID.bolsa, cantidad: 2, neto: '0.20', bolsas: 2 }]);
    expect(p2.porItem).toEqual([{ itemId: ID.bolsa, cantidad: 1, neto: '0.10', bolsas: 1 }]);
  });

  it('una parte con una partesRestantes que no es número es RangeError', () => {
    expect(() =>
      calcularParte(cuentaC(), [], { tipo: 'IGUALES', partesRestantes: '2' as never }, 'CONSUMO'),
    ).toThrow(RangeError);
  });
});

describe('calcularParte · entradas y estado inconsistentes', () => {
  it('rechaza un tipo de parte o un formato desconocidos con RangeError', () => {
    expect(() => calcularParte(cuentaC(), [], { tipo: 'X' } as never, 'DETALLADO')).toThrow(
      RangeError,
    );
    expect(() => calcularParte(cuentaC(), [], { tipo: 'TOTAL' }, 'X' as never)).toThrow(RangeError);
  });

  it('rechaza más de 200 ítems en la selección con RangeError', () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ itemId: `i${i}`, cantidad: 1 }));
    expect(() => calcularParte(cuentaC(), [], { tipo: 'ITEMS', items }, 'DETALLADO')).toThrow(
      RangeError,
    );
  });

  it('si las partes anteriores tomaron de más de lo que la cuenta tiene, es RangeError (la cuenta cambió sin permiso)', () => {
    const cuenta = cuentaC();
    const p1 = tomar(
      calcularParte(
        cuenta,
        [],
        { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 2 }] },
        'DETALLADO',
      ),
    );
    const menos = cuentaC({ lineas: [lineaLomo({ cantidad: 1 }), lineaGaseosa()] });
    expect(() => calcularParte(menos, [p1], { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(RangeError);
  });

  it('rechaza partes anteriores mal formadas con RangeError', () => {
    expect(() => calcularParte(cuentaC(), [{} as never], { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(
      RangeError,
    );
    expect(() => calcularParte(cuentaC(), null as never, { tipo: 'TOTAL' }, 'DETALLADO')).toThrow(
      RangeError,
    );
  });
});

describe('cambioDeCuentaPermitido · bordes', () => {
  it('una línea de precio 0.00 con partes cobradas no impide cambios (sus unidades no tienen dinero)', () => {
    const cuenta = cuentaC({
      lineas: [lineaLomo(), lineaGaseosa({ itemId: ID.mandarina, precioUnitario: '0.00' })],
    });
    const p1 = tomar(
      calcularParte(
        cuenta,
        [],
        { tipo: 'ITEMS', items: [{ itemId: ID.lomo, cantidad: 1 }] },
        'DETALLADO',
      ),
    );
    expect(cambioDeCuentaPermitido(cuenta, [p1])).toEqual({ permitido: true });
  });

  it('con partes iguales, quitar una línea sin ICBPER de la que ya se cobró una parte no es permitido', () => {
    const cuenta = cuentaC();
    const p1 = tomar(calcularParte(cuenta, [], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO'));
    const nueva = cuentaC({ lineas: [lineaLomo({ cantidad: 1 }), lineaGaseosa(), lineaBolsa()] });
    // lo gravado que falta sigue siendo positivo, pero lo exonerado ya no existe y se cobraron 1.50 de él
    expect(cambioDeCuentaPermitido(nueva, [p1])).toEqual({
      permitido: false,
      codigo: 'CUENTA_COBRADA_EN_PARTE',
    });
  });

  it('rechaza partes anteriores mal formadas con RangeError', () => {
    expect(() => cambioDeCuentaPermitido(cuentaC(), [{} as never])).toThrow(RangeError);
  });
});

describe('redondeoEfectivo y validarPagos · coherencia', () => {
  it('los pagos armados con redondeoEfectivo siempre son válidos y el vuelto sale del recibido (300 totales)', () => {
    const rnd = semilla(0x9b05688c);
    for (let i = 0; i < 300; i++) {
      const total = desdeCentimos(entero(rnd, 1, 200_000));
      const conOtros = rnd() < 0.5;
      const otro = conOtros
        ? desdeCentimos(entero(rnd, 0, Number(total.replace('.', ''))))
        : '0.00';
      const noEfectivo = conOtros && otro !== '0.00' ? [{ monto: otro }] : [];
      const { efectivo, redondeo } = redondeoEfectivo(total, noEfectivo);
      expect(new Decimal(efectivo).plus(redondeo).plus(otro).toFixed(2)).toBe(total);
      expect(new Decimal(redondeo).lt('0.10')).toBe(true);

      const pagos: PagoEntrada[] = [];
      if (noEfectivo.length > 0) pagos.push({ medio: 'YAPE', monto: otro });
      if (efectivo !== '0.00') {
        const recibido = new Decimal(efectivo).plus(entero(rnd, 0, 5000) / 100).toFixed(2);
        pagos.push({ medio: 'EFECTIVO', monto: efectivo, recibido });
      }
      // sin pago en efectivo el redondeo debe ser 0.00 (se cobra el total completo con el otro medio)
      const hayEfectivo = efectivo !== '0.00';
      const r = hayEfectivo ? redondeo : '0.00';
      if (!hayEfectivo && redondeo !== '0.00') continue;
      const resultado = validarPagos(total, pagos, r);
      expect(resultado.valido).toBe(true);
    }
  });

  it('los pagos que no son en efectivo por encima del total no cuadran (no es RangeError)', () => {
    expect(validarPagos('10.00', [{ medio: 'YAPE', monto: '20.00' }], '0.00')).toEqual({
      valido: false,
      codigo: 'PAGOS_NO_CUADRAN',
    });
    expect(
      validarPagos(
        '10.00',
        [
          { medio: 'YAPE', monto: '11.00' },
          { medio: 'EFECTIVO', monto: '0.01' },
        ],
        '0.00',
      ),
    ).toEqual({ valido: false, codigo: 'PAGOS_NO_CUADRAN' });
  });

  it('un medio desconocido es RangeError', () => {
    expect(() =>
      validarPagos('10.00', [{ medio: 'CHEQUE' as never, monto: '10.00' }], '0.00'),
    ).toThrow(RangeError);
  });
});

describe('esperadoDelTurno y diferenciasDelArqueo · bordes', () => {
  it('un medio desconocido o un tipo de movimiento desconocido es RangeError', () => {
    expect(() =>
      esperadoDelTurno({
        fondo: '0.00',
        pagos: [{ medio: 'CHEQUE' as never, monto: '1.00' }],
        movimientos: [],
      }),
    ).toThrow(RangeError);
    expect(() =>
      esperadoDelTurno({
        fondo: '0.00',
        pagos: [],
        movimientos: [{ tipo: 'OTRO' as never, monto: '1.00' }],
      }),
    ).toThrow(RangeError);
  });

  it('un medio ausente del contado vale cero y uno repetido es RangeError', () => {
    const esperado = esperadoDelTurno({ fondo: '10.00', pagos: [], movimientos: [] });
    const r = diferenciasDelArqueo(esperado, [{ medio: 'EFECTIVO', monto: '4.00' }]);
    expect(r.map((x) => x.medio)).toEqual([...MEDIOS_PAGO]);
    expect(r[0]).toEqual({
      medio: 'EFECTIVO',
      esperado: '10.00',
      contado: '4.00',
      diferencia: '-6.00',
    });
    expect(() =>
      diferenciasDelArqueo(esperado, [
        { medio: 'EFECTIVO', monto: '4.00' },
        { medio: 'EFECTIVO', monto: '1.00' },
      ]),
    ).toThrow(RangeError);
  });

  it('un cero nunca sale con signo menos', () => {
    const r = diferenciasDelArqueo(
      MEDIOS_PAGO.map((medio) => ({ medio, monto: '0.00' })),
      MEDIOS_PAGO.map((medio) => ({ medio, monto: '0.00' })),
    );
    expect(r.every((x) => x.diferencia === '0.00')).toBe(true);
  });
});
