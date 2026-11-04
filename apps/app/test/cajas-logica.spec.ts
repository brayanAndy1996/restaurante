import type { CajaRespuesta } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import {
  CAJA_VACIA,
  accionDeSerie,
  cambiosDeCaja,
  estadoDeTasa,
  numeroDeComprobante,
  pasosDeInicio,
  pideElPrimerNumero,
  serieDeEmisorAnterior,
  primerNumeroEscrito,
  serieEscrita,
  tasaEscrita,
  tasaVigente,
  textoDeUltimoNumero,
  validarCaja,
  validarTasa,
} from '../src/modulos/administracion/caja/cajas';

// spec: 006-caja-cobro, criterios 1 a 6 y 117 (lógica pura de Ajustes › Cajas y Emisores; pruebas no protegidas).

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EMISOR_PRUEBA = uuid(900);
const caja = (n: number, nombre: string, extra: Partial<CajaRespuesta> = {}): CajaRespuesta => ({
  id: uuid(n),
  sucursalId: uuid(1),
  nombre,
  activa: true,
  impresora: null,
  series: [],
  turnoAbierto: null,
  ...extra,
});
const conSeries = caja(10, 'Caja 1', {
  series: [
    { tipo: 'BOLETA', serie: 'B001', ultimoNumero: 130, activa: true, emisorId: EMISOR_PRUEBA },
    { tipo: 'BOLETA', serie: 'B000', ultimoNumero: 3, activa: false, emisorId: EMISOR_PRUEBA },
  ],
});

describe('tasaEscrita (criterio 6)', () => {
  it('lleva lo escrito a texto con 2 decimales, sin pasar por números de coma flotante', () => {
    expect(tasaEscrita('18')).toBe('18.00');
    expect(tasaEscrita(' 10,5 ')).toBe('10.50');
    expect(tasaEscrita('0.01')).toBe('0.01');
    expect(tasaEscrita('30')).toBe('30.00');
    expect(tasaEscrita('7.25')).toBe('7.25');
  });
  it('rechaza lo que la API rechazaría', () => {
    for (const malo of [
      '',
      'abc',
      '0',
      '0.00',
      '30.01',
      '31',
      '100',
      '1.234',
      '-5',
      '1e1',
      '18%',
    ]) {
      expect(tasaEscrita(malo), malo).toBeNull();
    }
  });
});

describe('validarTasa', () => {
  it('pide una fecha real y no repite una fecha que ya tiene tasa al crear', () => {
    const tasas = [{ desde: '2026-01-01', tasa: '18.00' }];
    expect(validarTasa({ desde: '2026-02-30', tasa: '18' }, tasas, false)).toMatchObject({
      ok: false,
      errores: { desde: expect.stringContaining('Elige la fecha') },
    });
    expect(validarTasa({ desde: '2026-01-01', tasa: '18' }, tasas, false)).toMatchObject({
      ok: false,
      errores: { desde: expect.stringContaining('Ya hay una tasa') },
    });
    expect(validarTasa({ desde: '2026-01-01', tasa: '10' }, tasas, true)).toEqual({
      ok: true,
      desde: '2026-01-01',
      tasa: '10.00',
    });
  });
});

describe('tasa vigente y primeros pasos (pregunta 19)', () => {
  const tasas = [
    { desde: '2020-01-01', tasa: '18.00' },
    { desde: '2026-12-01', tasa: '10.50' },
  ];
  it('rige la de la fecha más reciente que ya llegó', () => {
    expect(tasaVigente(tasas, '2026-11-04')?.tasa).toBe('18.00');
    expect(tasaVigente(tasas, '2026-12-01')?.tasa).toBe('10.50');
    expect(tasaVigente(tasas, '2019-12-31')).toBeUndefined();
    expect(estadoDeTasa(tasas[1]!, tasas, '2026-11-04')).toBe('PROGRAMADA');
    expect(estadoDeTasa(tasas[0]!, tasas, '2026-11-04')).toBe('VIGENTE');
    expect(estadoDeTasa(tasas[0]!, tasas, '2026-12-02')).toBe('ANTERIOR');
  });

  it('dice qué falta: caja, serie y tasa, en ese orden', () => {
    expect(
      pasosDeInicio([], { necesaria: true, configurada: false }).map((p) => [p.id, p.hecho]),
    ).toEqual([
      ['caja', false],
      ['series', false],
      ['tasa', false],
    ]);
    expect(
      pasosDeInicio([caja(1, 'A')], { necesaria: true, configurada: true }).map((p) => p.hecho),
    ).toEqual([true, false, true]);
    expect(
      pasosDeInicio([conSeries], { necesaria: true, configurada: true }).every((p) => p.hecho),
    ).toBe(true);
  });

  it('una caja inactiva no cuenta, y sin saber la tasa o en el Nuevo RUS ese paso no aparece', () => {
    expect(
      pasosDeInicio([{ ...conSeries, activa: false }], undefined).map((p) => [p.id, p.hecho]),
    ).toEqual([
      ['caja', false],
      ['series', false],
    ]);
    expect(pasosDeInicio([conSeries], { necesaria: false, configurada: false })).toHaveLength(2);
  });
});

describe('series (criterios 3 y 5)', () => {
  it('lo escrito queda en mayúsculas y sin espacios', () => {
    expect(serieEscrita(' b0 01 ')).toBe('B001');
  });

  it('"Primer número" solo se pide para una serie nueva de la caja', () => {
    expect(pideElPrimerNumero(undefined, 'BOLETA', 'B001')).toBe(true);
    expect(pideElPrimerNumero(undefined, 'BOLETA', '')).toBe(false);
    expect(pideElPrimerNumero(conSeries, 'BOLETA', 'B001')).toBe(false); // la activa
    expect(pideElPrimerNumero(conSeries, 'BOLETA', 'B000')).toBe(false); // una vieja: se reactiva
    expect(pideElPrimerNumero(conSeries, 'BOLETA', 'B002')).toBe(true);
    expect(accionDeSerie(conSeries, 'BOLETA', 'B001')).toBe('nada');
    expect(accionDeSerie(conSeries, 'BOLETA', 'B000')).toBe('reactivar');
    expect(accionDeSerie(conSeries, 'BOLETA', 'B002')).toBe('nueva');
    // La misma serie en otro tipo no es la de la caja.
    expect(accionDeSerie(conSeries, 'FACTURA', 'F001')).toBe('nueva');
  });

  it('el primer número es un entero de 1 a 99999999', () => {
    expect(primerNumeroEscrito(' 124 ')).toBe(124);
    expect(primerNumeroEscrito('99999999')).toBe(99_999_999);
    for (const malo of ['0', '100000000', '1.5', '-1', 'a', '', '12 3']) {
      expect(primerNumeroEscrito(malo), malo).toBeNull();
    }
  });

  it('el número de comprobante lleva ocho cifras', () => {
    expect(numeroDeComprobante('B001', 130)).toBe('B001-00000130');
    expect(textoDeUltimoNumero({ serie: 'B001', ultimoNumero: 0 })).toBe(
      'Aún no emitió comprobantes',
    );
    expect(textoDeUltimoNumero({ serie: 'B001', ultimoNumero: 130 })).toBe(
      'Último emitido: B001-00000130',
    );
  });
});

describe('validarCaja', () => {
  it('manda solo las series que cambian y el primer número solo de las nuevas', () => {
    const resultado = validarCaja(
      {
        ...CAJA_VACIA,
        nombre: ' Caja 1 ',
        serieBoleta: 'B001', // la activa: nada
        primerBoleta: '999', // se ignora: la serie ya existe
        serieFactura: 'f001',
        primerFactura: '25',
      },
      [conSeries],
      conSeries,
    );
    expect(resultado).toEqual({
      ok: true,
      nombre: 'Caja 1',
      impresoraId: null,
      series: [{ tipo: 'FACTURA', entrada: { serie: 'F001', primerNumero: 25 } }],
    });
  });

  it('el prefijo debe coincidir con el tipo y el nombre no se repite sin distinguir mayúsculas', () => {
    const resultado = validarCaja(
      { ...CAJA_VACIA, nombre: 'caja 1', serieBoleta: 'F001', serieFactura: 'B001' },
      [conSeries],
    );
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(Object.keys(resultado.errores).sort()).toEqual([
        'nombre',
        'serieBoleta',
        'serieFactura',
      ]);
    }
    // Editando esa misma caja, su nombre no choca consigo misma.
    expect(
      validarCaja({ ...CAJA_VACIA, nombre: 'caja 1', serieBoleta: 'B001' }, [conSeries], conSeries)
        .ok,
    ).toBe(true);
  });

  it('el nombre tiene entre 1 y 40 caracteres', () => {
    expect(validarCaja({ ...CAJA_VACIA, nombre: '   ' }, []).ok).toBe(false);
    expect(validarCaja({ ...CAJA_VACIA, nombre: 'a'.repeat(41) }, []).ok).toBe(false);
    expect(validarCaja({ ...CAJA_VACIA, nombre: 'a'.repeat(40) }, []).ok).toBe(true);
  });

  it('cambiosDeCaja envía solo lo distinto', () => {
    const con = caja(2, 'Caja', { impresora: { id: uuid(50), nombre: 'X', gaveta: false } });
    expect(cambiosDeCaja(con, 'Caja', uuid(50))).toEqual({});
    expect(cambiosDeCaja(con, 'Otra', uuid(50))).toEqual({ nombre: 'Otra' });
    expect(cambiosDeCaja(con, 'Caja', null)).toEqual({ impresoraId: null });
  });
});

describe('serieDeEmisorAnterior (criterio 5)', () => {
  it('es una serie de otro emisor cuando su emisor no es el de la sucursal', () => {
    const serie = conSeries.series[0];
    expect(serieDeEmisorAnterior(serie, EMISOR_PRUEBA)).toBe(false);
    expect(serieDeEmisorAnterior(serie, uuid(901))).toBe(true);
  });

  it('sin serie o sin saber el emisor de la sucursal, no se afirma nada', () => {
    expect(serieDeEmisorAnterior(undefined, EMISOR_PRUEBA)).toBe(false);
    expect(serieDeEmisorAnterior(conSeries.series[0], undefined)).toBe(false);
  });
});
