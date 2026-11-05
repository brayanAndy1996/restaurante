import type { CuentaRespuesta } from '@restaurante/contratos';
import { calcularParte } from '@restaurante/dominio/caja';
import { describe, expect, it } from 'vitest';
import { claveDeCobro, guardarEstadoDeCobro, leerEstadoDeCobro } from '../src/modulos/caja/partes';
import {
  billetesQueAlcanzan,
  boletaExigeCliente,
  calcularLaParte,
  CLIENTE_VACIO,
  falloDeCobro,
  entradaDeCuenta,
  huellaDeCobro,
  indiceDelResto,
  partesCobradas,
  resumirPagos,
  validarCliente,
  type PagoEscrito,
} from '../src/modulos/caja/cobro';
import { ErrorApi } from '../src/lib/errores';
import { falloDeCuenta } from '../src/modulos/caja/fallos';
import { demuestraQueNoSeGuardo } from '../src/modulos/salon/enviar-borrador';

// spec: 006-caja-cobro, criterios 21, 47, 50, 51, 55, 64 a 66 y 111 a 114 (lógica pura del cobro; pruebas no
// protegidas). Los montos que se esperan son los ejemplos del criterio 21 y de la cuenta C.

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LOMO = uuid(1001);
const GASEOSA = uuid(1002);
const BOLSA = uuid(1003);

const fila = (medio: PagoEscrito['medio'], extra: Partial<PagoEscrito> = {}): PagoEscrito => ({
  clave: `${medio}${Math.random()}`,
  medio,
  monto: '',
  recibido: '',
  operacion: '',
  ...extra,
});

function cuentaC(extra: Partial<CuentaRespuesta> = {}): CuentaRespuesta {
  const linea = (
    itemId: string,
    nombre: string,
    precio: string,
    cantidad: number,
    bruto: string,
    icbper = false,
  ) => ({
    itemId,
    nombre,
    modificadores: [],
    precioUnitario: precio,
    cantidad,
    cantidadCortesia: 0,
    cantidadFacturada: 0,
    afectacion: 'GRAVADO' as const,
    aplicaIcbper: icbper,
    bruto,
    descuento: null,
    descuentoCuenta: '0.00',
    neto: bruto,
    icbper: icbper ? '2.50' : '0.00',
  });
  return {
    ordenId: uuid(904),
    tipo: 'MESA',
    estado: 'ABIERTA',
    mesas: [{ id: uuid(104), nombre: '4' }],
    mozo: { id: uuid(800), nombre: 'Ana Ríos' },
    numeroLlamado: null,
    version: 3,
    lineas: [
      linea(LOMO, 'Lomo saltado', '28.00', 2, '56.00'),
      linea(GASEOSA, 'Gaseosa 1 L', '9.00', 1, '9.00'),
      linea(BOLSA, 'Bolsa plástica', '0.20', 5, '1.00', true),
    ],
    descuentoCuenta: null,
    cortesias: [],
    totales: {
      subtotal: '66.00',
      descuentos: '0.00',
      operaciones: { gravadas: '55.93', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '10.07',
      igvGratuitas: '0.00',
      icbper: '2.50',
      total: '68.50',
    },
    cobrado: '0.00',
    saldo: '68.50',
    modo: null,
    cobros: [],
    parametros: {
      tasaIgv: '18.00',
      montoIcbper: '0.50',
      regimen: 'GENERAL',
      tiposPermitidos: ['BOLETA', 'FACTURA'],
    },
    ...extra,
  };
}

describe('pagos: el efectivo, el redondeo y el vuelto salen del dominio (criterio 21)', () => {
  it('total 33.34 en efectivo: se cobra 33.30, el redondeo 0.04 es a favor del cliente y el vuelto sale del recibido', () => {
    const r = resumirPagos('33.34', [fila('EFECTIVO', { recibido: '50' })]);
    expect(r.problema).toBeNull();
    expect(r.filas[0]?.monto).toBe('33.30');
    expect(r.redondeo).toBe('0.04');
    expect(r.vuelto).toBe('16.70');
    expect(r.pagos).toEqual([{ medio: 'EFECTIVO', monto: '33.30', recibido: '50.00' }]);
  });

  it('«Exacto» (recibido vacío) no manda recibido y el vuelto es cero', () => {
    const r = resumirPagos('69.20', [fila('EFECTIVO')]);
    expect(r.pagos).toEqual([{ medio: 'EFECTIVO', monto: '69.20' }]);
    expect(r.vuelto).toBe('0.00');
    expect(r.redondeo).toBe('0.00');
  });

  it('Yape de 20.00 y el resto en efectivo: 14.60 sin redondeo, y 30.00 con redondeo 0.07 para 50.07', () => {
    const a = resumirPagos('34.60', [
      fila('EFECTIVO', { recibido: '20' }),
      fila('YAPE', { monto: '20', operacion: 'Y-123' }),
    ]);
    expect(a.problema).toBeNull();
    expect(a.filas.map((f) => f.monto)).toEqual(['14.60', '20.00']);
    expect(a.redondeo).toBe('0.00');
    expect(a.vuelto).toBe('5.40');
    expect(a.pagos).toEqual([
      { medio: 'EFECTIVO', monto: '14.60', recibido: '20.00' },
      { medio: 'YAPE', monto: '20.00', operacion: 'Y-123' },
    ]);
    const b = resumirPagos('50.07', [
      fila('EFECTIVO'),
      fila('YAPE', { monto: '20.00', operacion: 'Y-9' }),
    ]);
    expect(b.filas[0]?.monto).toBe('30.00');
    expect(b.redondeo).toBe('0.07');
  });

  it('sin efectivo se cobra al céntimo: una tarjeta cubre todo el total y pide su número de operación', () => {
    const sin = resumirPagos('69.20', [fila('TARJETA_CREDITO')]);
    expect(sin.pagos).toBeNull();
    expect(sin.problema).toBe('Escribe el número de operación del Tarjeta de crédito.');
    const con = resumirPagos('20.05', [fila('YAPE', { operacion: 'A1' })]);
    expect(con.problema).toBeNull();
    expect(con.filas[0]?.monto).toBe('20.05');
    expect(con.redondeo).toBe('0.00');
  });

  it('dos pagos fuera del efectivo: el primero cubre el resto', () => {
    const r = resumirPagos('69.20', [
      fila('TARJETA_DEBITO', { operacion: 'T-1' }),
      fila('PLIN', { monto: '20', operacion: 'P-2' }),
    ]);
    expect(indiceDelResto(r.filas.map(() => fila('YAPE')))).toBe(0);
    expect(r.filas.map((f) => f.monto)).toEqual(['49.20', '20.00']);
    expect(r.problema).toBeNull();
  });

  it('dice qué falta en palabras: monto sin escribir, operación, recibido de menos, efectivo que no queda, pagos de más', () => {
    expect(
      resumirPagos('34.60', [fila('EFECTIVO'), fila('YAPE', { operacion: 'A' })]).problema,
    ).toBe('Escribe cuánto paga con Yape.');
    expect(resumirPagos('34.60', [fila('EFECTIVO'), fila('YAPE', { monto: '10' })]).problema).toBe(
      'Escribe el número de operación del Yape.',
    );
    expect(resumirPagos('34.60', [fila('EFECTIVO', { recibido: '30' })]).problema).toMatch(
      /Recibiste menos que el efectivo/,
    );
    expect(
      resumirPagos('20.05', [fila('EFECTIVO'), fila('YAPE', { monto: '20', operacion: 'A' })])
        .problema,
    ).toMatch(/No queda efectivo/);
    expect(
      resumirPagos('20.00', [fila('EFECTIVO'), fila('YAPE', { monto: '30', operacion: 'A' })])
        .problema,
    ).toMatch(/pasa del total/);
    expect(resumirPagos('20.00', []).problema).toBe('Elige cómo paga el cliente.');
  });

  it('una parte de 0.00 (solo cortesías) se cobra sin pagos', () => {
    const r = resumirPagos('0.00', []);
    expect(r.pagos).toEqual([]);
    expect(r.problema).toBeNull();
  });

  it('los atajos de billetes son los que alcanzan para el efectivo', () => {
    expect(billetesQueAlcanzan('33.30')).toEqual(['50.00', '100.00', '200.00']);
    expect(billetesQueAlcanzan('250.00')).toEqual([]);
    expect(billetesQueAlcanzan(null)).toHaveLength(5);
  });
});

describe('la parte que se cobra (criterios 64 a 66)', () => {
  it('toda la cuenta: el total es el que calcula el dominio con el ICBPER', () => {
    const p = calcularLaParte(cuentaC(), [], { tipo: 'TOTAL' }, 'DETALLADO');
    expect(p).toMatchObject({ ok: true, total: '68.50', entrada: { tipo: 'TOTAL' } });
  });

  it('por ítems: el total de la parte sale de calcularParte al momento', () => {
    const p = calcularLaParte(
      cuentaC(),
      [],
      { tipo: 'ITEMS', unidades: { [LOMO]: 1, [GASEOSA]: 1, [BOLSA]: 0 } },
      'DETALLADO',
    );
    expect(p).toMatchObject({ ok: true, total: '37.00' });
    expect(p.ok && p.entrada).toEqual({
      tipo: 'ITEMS',
      items: [
        { itemId: LOMO, cantidad: 1 },
        { itemId: GASEOSA, cantidad: 1 },
      ],
    });
  });

  it('sin unidades elegidas no hay parte', () => {
    expect(calcularLaParte(cuentaC(), [], { tipo: 'ITEMS', unidades: {} }, 'DETALLADO')).toEqual({
      ok: false,
      motivo: 'VACIA',
    });
  });

  it('partes iguales: cada parte es el saldo entre las que faltan, hacia arriba, y la última toma el resto', () => {
    const c = cuentaC();
    const primera = calcularLaParte(c, [], { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO');
    expect(primera).toMatchObject({ ok: true, total: '34.25' });
    if (!primera.ok || !primera.calculada) throw new Error('Se esperaba una parte');
    const segunda = calcularLaParte(
      cuentaC({ cobrado: '34.25', saldo: '34.25', modo: 'IGUALES', version: 4 }),
      [primera.calculada],
      { tipo: 'IGUALES', partesRestantes: 1 },
      'CONSUMO',
    );
    expect(segunda).toMatchObject({ ok: true, total: '34.25' });
  });

  it('el detallado no vale en partes iguales y un monto de dominio inválido no revienta la pantalla', () => {
    expect(
      calcularLaParte(cuentaC(), [], { tipo: 'IGUALES', partesRestantes: 2 }, 'DETALLADO'),
    ).toEqual({ ok: false, motivo: 'INVALIDA' });
  });

  it('con cobros hechos desde otro equipo se divide igual: los detalles de la cuenta son las partes anteriores', () => {
    const base = cuentaC();
    const primera = calcularParte(
      entradaDeCuenta(base),
      [],
      { tipo: 'ITEMS', items: [{ itemId: LOMO, cantidad: 1 }] },
      'DETALLADO',
    );
    if (!primera.valida) throw new Error('Se esperaba una parte');
    const { valida: _valida, ...detalleParte } = primera;
    const c = cuentaC({
      cobrado: detalleParte.totales.total,
      saldo: '40.50',
      modo: 'ITEMS',
      cobros: [
        {
          id: uuid(8000),
          comprobante: { id: uuid(8001), tipo: 'BOLETA', numero: 'B001-00000007' },
          total: detalleParte.totales.total,
          cobradoEn: '2026-11-06T00:10:00.000Z',
          cobradoPor: { id: uuid(800), nombre: 'Ana Ríos' },
          detalleParte,
        },
      ],
    });
    expect(partesCobradas(c)).toEqual([detalleParte]);

    // Por ítems: lo que sigue es lo que calcula el dominio con esa parte anterior.
    const esperada = calcularParte(
      entradaDeCuenta(c),
      [detalleParte],
      { tipo: 'ITEMS', items: [{ itemId: GASEOSA, cantidad: 1 }] },
      'DETALLADO',
    );
    if (!esperada.valida) throw new Error('Se esperaba una parte');
    expect(
      calcularLaParte(
        c,
        partesCobradas(c),
        { tipo: 'ITEMS', unidades: { [GASEOSA]: 1 } },
        'DETALLADO',
      ),
    ).toMatchObject({ ok: true, total: esperada.totales.total, calculada: { tipo: 'ITEMS' } });

    // Lo que falta (todo) y partes iguales también siguen, con el saldo que queda.
    expect(calcularLaParte(c, partesCobradas(c), { tipo: 'TOTAL' }, 'DETALLADO')).toMatchObject({
      ok: true,
      total: '40.50',
    });
    expect(
      calcularLaParte(c, partesCobradas(c), { tipo: 'IGUALES', partesRestantes: 2 }, 'CONSUMO'),
    ).toMatchObject({ ok: true, total: '20.25', entrada: { tipo: 'IGUALES', partesRestantes: 2 } });
  });

  it('después de partes iguales solo siguen partes iguales: «lo que falta» es la última', () => {
    const primera = calcularLaParte(
      cuentaC(),
      [],
      { tipo: 'IGUALES', partesRestantes: 3 },
      'CONSUMO',
    );
    if (!primera.ok) throw new Error('Se esperaba una parte');
    const c = cuentaC({
      cobrado: primera.total,
      saldo: '45.66',
      modo: 'IGUALES',
      cobros: [
        {
          id: uuid(8000),
          comprobante: { id: uuid(8001), tipo: 'BOLETA', numero: 'B001-00000007' },
          total: primera.total,
          cobradoEn: '2026-11-06T00:10:00.000Z',
          cobradoPor: null,
          detalleParte: primera.calculada,
        },
      ],
    });
    const anteriores = partesCobradas(c);
    expect(calcularLaParte(c, anteriores, { tipo: 'TOTAL' }, 'CONSUMO')).toEqual({
      ok: false,
      motivo: 'INVALIDA',
    });
    expect(
      calcularLaParte(c, anteriores, { tipo: 'IGUALES', partesRestantes: 1 }, 'CONSUMO'),
    ).toMatchObject({ ok: true, total: c.saldo });
  });
});

describe('el cliente del comprobante (criterio 51, pregunta 15)', () => {
  it('una boleta de hasta S/ 700.00 no exige cliente; de más, sí', () => {
    expect(boletaExigeCliente('700.00')).toBe(false);
    expect(boletaExigeCliente('700.01')).toBe(true);
    expect(validarCliente('BOLETA', '69.20', CLIENTE_VACIO)).toEqual({
      ok: true,
      cliente: undefined,
    });
    const exige = validarCliente('BOLETA', '700.01', CLIENTE_VACIO);
    expect(exige).toMatchObject({ ok: false });
    expect(exige.ok ? null : exige.errores.numero).toBe('Escribe los 8 dígitos del DNI');
    expect(
      validarCliente('BOLETA', '700.01', {
        ...CLIENTE_VACIO,
        numero: '12345678',
        nombre: 'Rosa Vega',
      }),
    ).toEqual({
      ok: true,
      cliente: { tipoDocumento: 'DNI', numero: '12345678', nombre: 'Rosa Vega' },
    });
  });

  it('acepta carné de extranjería y pasaporte, y si se empieza a escribir tiene que estar completo', () => {
    expect(
      validarCliente('BOLETA', '10.00', {
        tipoDocumento: 'PASAPORTE',
        numero: 'X1234567',
        nombre: 'John Smith',
        direccion: '',
      }),
    ).toMatchObject({ ok: true, cliente: { tipoDocumento: 'PASAPORTE' } });
    expect(validarCliente('BOLETA', '10.00', { ...CLIENTE_VACIO, numero: '1234' })).toMatchObject({
      ok: false,
      errores: { numero: expect.any(String), nombre: expect.any(String) },
    });
  });

  it('la boleta acepta RUC como documento, con la misma validación que la factura', () => {
    const boleta = (numero: string) =>
      validarCliente('BOLETA', '700.01', {
        tipoDocumento: 'RUC',
        numero,
        nombre: 'Supermercados Peruanos S.A.',
        direccion: '',
      });
    expect(boleta('20100070970')).toEqual({
      ok: true,
      cliente: {
        tipoDocumento: 'RUC',
        numero: '20100070970',
        nombre: 'Supermercados Peruanos S.A.',
      },
    });
    // Dígito verificador mal, y menos de 11 dígitos: el mismo mensaje que en la factura.
    for (const mal of ['20100070971', '2010007097']) {
      expect(boleta(mal)).toMatchObject({
        ok: false,
        errores: { numero: 'Escribe un RUC válido de 11 dígitos' },
      });
    }
    // En boleta la dirección no se pide.
    expect(boleta('20100070970')).toMatchObject({ ok: true });
  });

  it('la factura exige RUC válido, razón social y dirección', () => {
    const vacio = validarCliente('FACTURA', '10.00', CLIENTE_VACIO);
    expect(vacio).toMatchObject({
      ok: false,
      errores: {
        numero: 'Escribe un RUC válido de 11 dígitos',
        nombre: 'Escribe la razón social',
        direccion: 'Escribe la dirección fiscal',
      },
    });
    expect(
      validarCliente('FACTURA', '10.00', {
        ...CLIENTE_VACIO,
        numero: '20100070970',
        nombre: 'Supermercados Peruanos S.A.',
        direccion: 'Av. Principal 123, Lima',
      }),
    ).toEqual({
      ok: true,
      cliente: {
        tipoDocumento: 'RUC',
        numero: '20100070970',
        nombre: 'Supermercados Peruanos S.A.',
        direccion: 'Av. Principal 123, Lima',
      },
    });
    expect(
      validarCliente('FACTURA', '10.00', {
        ...CLIENTE_VACIO,
        numero: '20100070971',
        nombre: 'X',
        direccion: 'Y',
      }),
    ).toMatchObject({ ok: false, errores: { numero: 'Escribe un RUC válido de 11 dígitos' } });
  });
});

describe('el id del cobro y lo que recuerda el equipo (criterio 55)', () => {
  const entrada = {
    turnoId: uuid(5),
    parte: { tipo: 'TOTAL' as const },
    comprobante: { tipo: 'BOLETA' as const, formato: 'DETALLADO' as const },
    pagos: [{ medio: 'EFECTIVO' as const, monto: '10.00' }],
    redondeo: '0.00',
  };

  it('la huella no cambia con la versión ni el total, sí con los pagos', () => {
    const a = huellaDeCobro(entrada);
    expect(huellaDeCobro({ ...entrada })).toBe(a);
    expect(
      huellaDeCobro({ ...entrada, pagos: [{ medio: 'YAPE', monto: '10.00', operacion: 'A' }] }),
    ).not.toBe(a);
  });

  it('de lo cobrado solo recuerda el id del cobro en curso; sin cobro en curso borra la clave', () => {
    const clave = claveDeCobro('e', 'u', 'o');
    expect(leerEstadoDeCobro(clave).enCurso).toBeNull();
    guardarEstadoDeCobro(clave, { enCurso: { id: uuid(9), huella: 'h' } });
    expect(leerEstadoDeCobro(clave)).toEqual({ enCurso: { id: uuid(9), huella: 'h' } });
    // Un estado viejo con partes guardadas se lee sin ellas.
    localStorage.setItem(clave, JSON.stringify({ cobradas: [{ cobroId: 'x' }], enCurso: null }));
    expect(leerEstadoDeCobro(clave)).toEqual({ enCurso: null });
    guardarEstadoDeCobro(clave, { enCurso: { id: uuid(9), huella: 'h' } });
    guardarEstadoDeCobro(clave, { enCurso: null });
    expect(localStorage.getItem(clave)).toBeNull();
  });
});

describe('los errores del cobro en palabras (criterios 49 a 63 y 114)', () => {
  const error = (codigo: string, estado = 409, extra: { ordenId?: string } = {}) =>
    new ErrorApi({ estado, codigo, mensaje: codigo, ...extra });

  it('CUENTA_CAMBIO pide leer la cuenta de nuevo y dice que lo escrito sigue ahí', () => {
    const f = falloDeCobro(error('CUENTA_CAMBIO'));
    expect(f.cuentaCambio).toBe(true);
    expect(f.texto).toMatch(/La cuenta cambió/);
    expect(f.texto).toMatch(/Lo que escribiste sigue aquí/);
  });

  it('una cuenta unida manda a la principal; un turno cerrado manda a Caja; una serie faltante, a Ajustes', () => {
    expect(falloDeCobro(error('ORDEN_NO_ABIERTA', 409, { ordenId: uuid(2) }))).toMatchObject({
      cuentaCerrada: true,
      ordenPrincipalId: uuid(2),
    });
    expect(falloDeCobro(error('TURNO_CERRADO')).turno).toBe(true);
    expect(falloDeCobro(error('SIN_SERIE')).texto).toMatch(/Ajustes › Cajas/);
    expect(falloDeCobro(error('TASA_IGV_NO_CONFIGURADA')).texto).toMatch(/Ajustes › Emisores/);
  });

  it('un corte de red o un 5xx se puede reintentar con el mismo cobro', () => {
    expect(falloDeCobro(error('SIN_CONEXION', 0)).repetir).toBe(true);
    expect(falloDeCobro(error('ERROR_INTERNO', 500)).repetir).toBe(true);
    expect(falloDeCobro(error('CONFLICTO')).repetir).toBe(true);
  });
});

describe('los cambios que ya cobrados rechazan, en palabras (criterios 86 a 88)', () => {
  const error = (codigo: string) => new ErrorApi({ estado: 409, codigo, mensaje: codigo });

  it('anular algo que ya se cobró se dice en palabras y manda a la nota de crédito', () => {
    expect(falloDeCuenta(error('CUENTA_COBRADA_EN_PARTE'))?.texto).toMatch(
      /ya tiene cobros.*nota de crédito/,
    );
  });

  it('anular o unir una cuenta con cobros: CUENTA_EN_COBRO', () => {
    expect(falloDeCuenta(error('CUENTA_EN_COBRO'))?.texto).toMatch(/ya tiene cobros/);
  });

  it('un envío rechazado por lo ya cobrado no se guardó: el próximo «Enviar» usa otro id', () => {
    expect(demuestraQueNoSeGuardo(error('CUENTA_COBRADA_EN_PARTE'))).toBe(true);
    expect(demuestraQueNoSeGuardo(error('CONFLICTO'))).toBe(false);
  });
});
