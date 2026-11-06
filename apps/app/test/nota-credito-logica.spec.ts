import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/errores';
import {
  calcularLaNota,
  devueltoDe,
  entradaDeNota,
  esRespuestaFinal,
  falloDeNota,
  huellaDeNota,
  huellaDelCuerpoDeNota,
  lineasPorAcreditar,
  objetivoDeNota,
  sePuedeEmitirNota,
  textoDeMedios,
  tiposDeNota,
  unidadesElegidas,
} from '../src/modulos/facturacion/notas-credito';
import { boletaAceptada, lineaDeComprobante } from './ayudas-facturacion';
import { uuid } from './ayudas-salon';

// spec: 006-caja-cobro, criterios 143 a 148 y 177 en la interfaz (pruebas no protegidas de la lógica de la nota de
// crédito de la PWA). Los montos salen de `calcularNotaCredito`; aquí solo se comprueba que la PWA se los pasa bien.

const algoYaDevuelto = () =>
  boletaAceptada({
    notasCredito: [
      {
        id: uuid(7100),
        tipo: 'DEVOLUCION',
        numero: 'BC01-00000001',
        estado: 'ACEPTADO',
        total: '28.00',
      },
    ],
    acreditado: [
      {
        posicion: 1,
        cantidad: 1,
        neto: '28.00',
        base: '23.73',
        igv: '4.27',
        bolsas: 0,
        icbper: '0.00',
      },
    ],
  });

describe('Qué admite cada comprobante (criterios 143, 146 y 148)', () => {
  it('una boleta aceptada sin notas admite anular, devolver y cambiar a factura', () => {
    expect(tiposDeNota(boletaAceptada())).toEqual(['ANULACION', 'DEVOLUCION', 'CAMBIO_A_FACTURA']);
    expect(sePuedeEmitirNota(boletaAceptada())).toBe(true);
  });

  it('una factura no se cambia a factura', () => {
    expect(tiposDeNota(boletaAceptada({ tipo: 'FACTURA' }))).toEqual(['ANULACION', 'DEVOLUCION']);
  });

  it('un emisor del Nuevo RUS no cambia la boleta a factura', () => {
    const rus = boletaAceptada();
    rus.emisor = { ...rus.emisor, regimen: 'NUEVO_RUS' };
    expect(tiposDeNota(rus)).toEqual(['ANULACION', 'DEVOLUCION']);
  });

  it('con una nota que cuenta, solo se devuelve lo que queda (pregunta 32)', () => {
    expect(tiposDeNota(algoYaDevuelto())).toEqual(['DEVOLUCION']);
  });

  it('si ya se devolvió todo lo devolvible, no hay nada que ofrecer; la cortesía no se devuelve', () => {
    const todo = boletaAceptada({
      notasCredito: [
        {
          id: uuid(7100),
          tipo: 'DEVOLUCION',
          numero: 'BC01-00000001',
          estado: 'ACEPTADO',
          total: '66.20',
        },
      ],
      acreditado: [
        {
          posicion: 1,
          cantidad: 2,
          neto: '56.00',
          base: '47.46',
          igv: '8.54',
          bolsas: 0,
          icbper: '0.00',
        },
        {
          posicion: 2,
          cantidad: 1,
          neto: '9.00',
          base: '7.63',
          igv: '1.37',
          bolsas: 0,
          icbper: '0.00',
        },
        {
          posicion: 3,
          cantidad: 2,
          neto: '0.20',
          base: '0.17',
          igv: '0.03',
          bolsas: 2,
          icbper: '1.00',
        },
      ],
    });
    expect(tiposDeNota(todo)).toEqual([]);
    expect(sePuedeEmitirNota(todo)).toBe(false);
  });

  it('solo una boleta o factura ACEPTADA admite nota; una nota, un rechazado o un anulado, no', () => {
    expect(tiposDeNota(boletaAceptada({ estado: 'RECHAZADO' }))).toEqual([]);
    expect(tiposDeNota(boletaAceptada({ estado: 'ANULADO' }))).toEqual([]);
    expect(tiposDeNota(boletaAceptada({ estado: 'POR_ENVIAR' }))).toEqual([]);
    expect(tiposDeNota(boletaAceptada({ tipo: 'NOTA_CREDITO_BOLETA' }))).toEqual([]);
  });

  it('cuenta lo que falta por línea con lo acreditado por las notas', () => {
    const lineas = lineasPorAcreditar(algoYaDevuelto());
    expect(lineas.map((l) => [l.posicion, l.cantidad, l.acreditadas, l.faltan])).toEqual([
      [1, 2, 1, 1],
      [2, 1, 0, 1],
      [3, 2, 0, 2],
      [4, 1, 0, 0],
    ]);
  });
});

describe('La nota que se arma con calcularNotaCredito (criterio 147)', () => {
  it('devolver 1 Lomo da S/ 28.00, con la base y el IGV del ejemplo del criterio', () => {
    const nota = calcularLaNota(boletaAceptada(), 'DEVOLUCION', { 1: 1 });
    expect(nota.ok).toBe(true);
    if (!nota.ok) return;
    expect(nota.total).toBe('28.00');
    expect(nota.totales).toMatchObject({ igv: '4.27', icbper: '0.00' });
    expect(nota.lineas[0]).toMatchObject({ posicionOrigen: 1, base: '23.73', igv: '4.27' });
    expect(nota.devueltas).toEqual([{ posicion: 1, cantidad: 1 }]);
  });

  it('devolver 1 Bolsa da S/ 0.60 con su ICBPER', () => {
    const nota = calcularLaNota(boletaAceptada(), 'DEVOLUCION', { 3: 1 });
    expect(nota.ok && nota.total).toBe('0.60');
    expect(nota.ok && nota.totales.icbper).toBe('0.50');
  });

  it('anular acredita todo, también la línea gratuita, y no lleva unidades', () => {
    const nota = calcularLaNota(boletaAceptada(), 'ANULACION', {});
    expect(nota.ok).toBe(true);
    if (!nota.ok) return;
    expect(nota.lineas).toHaveLength(4);
    expect(nota.total).toBe('66.20');
    expect(nota.devueltas).toBeNull();
    expect(calcularLaNota(boletaAceptada(), 'CAMBIO_A_FACTURA', {})).toMatchObject({
      ok: true,
      total: '66.20',
    });
  });

  it('sin unidades elegidas no hay nota; las unidades se recortan a lo que falta y la cortesía no cuenta', () => {
    expect(calcularLaNota(boletaAceptada(), 'DEVOLUCION', {})).toEqual({
      ok: false,
      motivo: 'SIN_UNIDADES',
    });
    expect(unidadesElegidas(algoYaDevuelto(), { 1: 5, 4: 1, 2: 0 })).toEqual([
      { posicion: 1, cantidad: 1 },
    ]);
  });

  it('con una devolución anterior, la última unidad cierra la base y el IGV del original', () => {
    const nota = calcularLaNota(algoYaDevuelto(), 'DEVOLUCION', { 1: 1 });
    expect(nota.ok && nota.total).toBe('28.00');
    expect(nota.ok && nota.lineas[0]).toMatchObject({ base: '23.73', igv: '4.27' });
  });

  it('anular un comprobante que ya tiene notas no vale', () => {
    expect(calcularLaNota(algoYaDevuelto(), 'ANULACION', {})).toEqual({
      ok: false,
      motivo: 'INVALIDA',
    });
  });

  it('una línea gratuita sin valor referencial es un comprobante que no se puede leer', () => {
    const roto = boletaAceptada();
    roto.lineas = roto.lineas.map((l) => (l.gratuita ? { ...l, valorReferencial: null } : l));
    expect(calcularLaNota(roto, 'ANULACION', {})).toEqual({ ok: false, motivo: 'DATOS' });
  });

  it('un monto con más de 2 decimales en el comprobante no se calcula (RangeError del dominio)', () => {
    const roto = boletaAceptada();
    roto.lineas = [lineaDeComprobante({ neto: '28.001' })];
    expect(calcularLaNota(roto, 'ANULACION', {})).toEqual({ ok: false, motivo: 'DATOS' });
  });
});

describe('Lo que se manda y lo que se autoriza (criterios 144, 145 y 153)', () => {
  const datos = {
    id: uuid(9001),
    comprobanteId: uuid(7000),
    motivo: 'Producto en mal estado',
    total: '28.00',
    devueltas: [{ posicion: 1, cantidad: 1 }],
    devolucion: {
      turnoId: uuid(300),
      pagos: [{ medio: 'EFECTIVO' as const, monto: '28.00' }],
      redondeo: '0.00',
    },
    cliente: undefined,
  };

  it('una devolución lleva líneas y devolución; no lleva cliente', () => {
    expect(entradaDeNota({ ...datos, tipo: 'DEVOLUCION' })).toEqual({
      id: datos.id,
      comprobanteId: datos.comprobanteId,
      tipo: 'DEVOLUCION',
      motivo: datos.motivo,
      total: '28.00',
      lineas: [{ posicion: 1, cantidad: 1 }],
      devolucion: datos.devolucion,
    });
  });

  it('una anulación sin turno manda devolucion: null y ninguna línea', () => {
    expect(
      entradaDeNota({ ...datos, tipo: 'ANULACION', devueltas: null, devolucion: null }),
    ).toEqual({
      id: datos.id,
      comprobanteId: datos.comprobanteId,
      tipo: 'ANULACION',
      motivo: datos.motivo,
      total: '28.00',
      devolucion: null,
    });
  });

  it('un cambio a factura lleva el cliente y nunca la devolución', () => {
    const cliente = {
      tipoDocumento: 'RUC' as const,
      numero: '20100070970',
      nombre: 'Supermercados Peruanos S.A.',
      direccion: 'Av. Principal 123',
    };
    const entrada = entradaDeNota({
      ...datos,
      tipo: 'CAMBIO_A_FACTURA',
      devueltas: null,
      devolucion: null,
      cliente,
    });
    expect(entrada).toEqual({
      id: datos.id,
      comprobanteId: datos.comprobanteId,
      tipo: 'CAMBIO_A_FACTURA',
      motivo: datos.motivo,
      total: '28.00',
      cliente,
    });
    expect('devolucion' in entrada).toBe(false);
  });

  it('el objetivo es el de la nota: ids en minúsculas y lo devuelto es la suma de los pagos', () => {
    expect(devueltoDe(datos.devolucion.pagos)).toBe('28.00');
    expect(devueltoDe([{ monto: '10.00' }, { monto: '5.50' }])).toBe('15.50');
    expect(devueltoDe(null)).toBe('0.00');
    expect(objetivoDeNota(uuid(7000).toUpperCase(), 'DEVOLUCION', '28.00', '28.00')).toEqual({
      tipo: 'NOTA_CREDITO',
      comprobanteId: uuid(7000),
      tipoNota: 'DEVOLUCION',
      total: '28.00',
      devuelto: '28.00',
    });
  });

  it('la huella que conserva el id no cuenta el total ni el motivo; la del cuerpo sí', () => {
    const base = entradaDeNota({ ...datos, tipo: 'DEVOLUCION' });
    const corregida = { ...base, motivo: 'Otro motivo', total: '29.00' };
    expect(huellaDeNota(corregida)).toBe(huellaDeNota(base));
    expect(huellaDelCuerpoDeNota(corregida)).not.toBe(huellaDelCuerpoDeNota(base));
    const otraLinea = { ...base, lineas: [{ posicion: 2, cantidad: 1 }] };
    expect(huellaDeNota(otraLinea)).not.toBe(huellaDeNota(base));
  });

  it('dice los medios de la devolución en palabras', () => {
    expect(textoDeMedios(['EFECTIVO'])).toBe('en efectivo');
    expect(textoDeMedios(['EFECTIVO', 'YAPE'])).toBe('en efectivo y Yape');
    expect(textoDeMedios(['EFECTIVO', 'YAPE', 'PLIN'])).toBe('en efectivo, Yape y Plin');
    expect(textoDeMedios([])).toBe('');
  });
});

describe('Los errores en palabras', () => {
  const error = (estado: number, codigo: string, mensaje = 'x', campos = []) =>
    new ErrorApi({ estado, codigo, mensaje, campos });

  it('NOTA_CREDITO_CAMBIO dice el total nuevo, pide revisar y manda releer', () => {
    const f = falloDeNota(
      error(409, 'NOTA_CREDITO_CAMBIO', 'cambió', [
        { campo: 'total', mensaje: 'El total ahora es S/ 28.00' },
      ] as never),
    );
    expect(f.titulo).toBe('El total de la nota cambió');
    expect(f.texto).toContain('El total ahora es S/ 28.00');
    expect(f.texto).toContain('Lo que escribiste sigue aquí');
    expect(f.releer).toBe(true);
  });

  it('NADA_QUE_ACREDITAR manda releer y pide elegir de nuevo', () => {
    const f = falloDeNota(error(422, 'NADA_QUE_ACREDITAR'));
    expect(f.texto).toContain('ya no le queda nada por acreditar');
    expect(f.releer).toBe(true);
  });

  it('SIN_SERIE manda al Administrador a Ajustes › Cajas', () => {
    expect(falloDeNota(error(409, 'SIN_SERIE')).texto).toContain('Ajustes › Cajas');
  });

  it('un corte de red lo dice con palabras de la app, no con códigos', () => {
    const f = falloDeNota(error(0, 'SIN_CONEXION'));
    expect(f.texto).toBe(
      'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.',
    );
  });

  it('solo una respuesta de la API que dice «no» suelta el id; un corte, un 5xx o un cruce, no', () => {
    expect(esRespuestaFinal(error(422, 'NOTA_CREDITO_INVALIDA'))).toBe(true);
    expect(esRespuestaFinal(error(409, 'NOTA_CREDITO_CAMBIO'))).toBe(true);
    expect(esRespuestaFinal(error(403, 'AUTORIZACION_INVALIDA'))).toBe(true);
    expect(esRespuestaFinal(error(0, 'SIN_CONEXION'))).toBe(false);
    expect(esRespuestaFinal(error(500, 'ERROR_INTERNO'))).toBe(false);
    expect(esRespuestaFinal(error(409, 'CONFLICTO'))).toBe(false);
    expect(esRespuestaFinal(error(0, 'ENVIO_CANCELADO'))).toBe(false);
    expect(esRespuestaFinal(new Error('x'))).toBe(false);
  });
});
