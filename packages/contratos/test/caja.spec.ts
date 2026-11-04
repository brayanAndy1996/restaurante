import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERROR,
  abrirTurnoEntradaSchema,
  autorizacionEntradaSchema,
  autorizacionRespuestaSchema,
  cajaEntradaSchema,
  cajaModificarEntradaSchema,
  cierreEntradaSchema,
  cobroEntradaSchema,
  cortesiaEntradaSchema,
  descuentoEntradaSchema,
  errorRespuestaSchema,
  movimientoEntradaSchema,
  objetivoAutorizacionSchema,
  pagoCobroEntradaSchema,
  parteEntradaSchema,
  precuentaRespuestaSchema,
  comandaKdsSchema,
  serieEntradaDeTipoSchema,
  serieEntradaSchema,
  tasaIgvEntradaSchema,
  ventaMostradorEntradaSchema,
} from '../src';

// Esquemas de Caja y cobro (historia 006, entrega 6a): formato de los datos, no reglas de negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';

function campos(resultado: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (resultado.error?.issues ?? []).map((i) => i.path.join('.'));
}

describe('cajas y series (criterios 1 y 3)', () => {
  it('cajaEntrada: nombre de 1 a 40 e impresora opcional', () => {
    expect(cajaEntradaSchema.safeParse({ nombre: 'Caja 1' }).success).toBe(true);
    expect(cajaEntradaSchema.safeParse({ nombre: 'a'.repeat(40), impresoraId: ID_1 }).success).toBe(
      true,
    );
    expect(cajaEntradaSchema.safeParse({ nombre: 'Caja 1', impresoraId: null }).success).toBe(true);
    for (const mala of [
      {},
      { nombre: '' },
      { nombre: '   ' },
      { nombre: 'a'.repeat(41) },
      { nombre: 'Caja', impresoraId: 'x' },
      { nombre: 'Caja', activa: true },
      { nombre: 'Caja', empresaId: ID_1 },
    ]) {
      expect(cajaEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });

  it('cajaModificarEntrada: al menos un campo y nada desconocido', () => {
    expect(cajaModificarEntradaSchema.safeParse({ activa: false }).success).toBe(true);
    expect(cajaModificarEntradaSchema.safeParse({ impresoraId: null }).success).toBe(true);
    expect(cajaModificarEntradaSchema.safeParse({ nombre: 'Barra' }).success).toBe(true);
    expect(cajaModificarEntradaSchema.safeParse({}).success).toBe(false);
    expect(cajaModificarEntradaSchema.safeParse({ activa: 'si' }).success).toBe(false);
    expect(cajaModificarEntradaSchema.safeParse({ nombre: 'x', sucursalId: ID_1 }).success).toBe(
      false,
    );
  });

  it('serieEntrada: cuatro caracteres B o F y primerNumero de 1 a 99999999', () => {
    expect(serieEntradaSchema.safeParse({ serie: 'B001' }).success).toBe(true);
    expect(serieEntradaSchema.safeParse({ serie: 'F0A9', primerNumero: 99999999 }).success).toBe(
      true,
    );
    for (const mala of [
      { serie: 'b001' },
      { serie: 'B01' },
      { serie: 'B0011' },
      { serie: 'X001' },
      { serie: 'B00-' },
      { serie: 'B001', primerNumero: 0 },
      { serie: 'B001', primerNumero: 100000000 },
      { serie: 'B001', primerNumero: 1.5 },
      { serie: 'B001', primerNumero: '1' },
      { serie: 'B001', ultimoNumero: 5 },
    ]) {
      expect(serieEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });

  it('serieEntradaDeTipo: B para BOLETA y F para FACTURA', () => {
    expect(serieEntradaDeTipoSchema('BOLETA').safeParse({ serie: 'B001' }).success).toBe(true);
    expect(serieEntradaDeTipoSchema('BOLETA').safeParse({ serie: 'F001' }).success).toBe(false);
    expect(serieEntradaDeTipoSchema('FACTURA').safeParse({ serie: 'F001' }).success).toBe(true);
    const mala = serieEntradaDeTipoSchema('FACTURA').safeParse({ serie: 'B001' });
    expect(campos(mala)).toEqual(['serie']);
  });

  it('tasaIgvEntrada: de 0.01 a 30.00 con hasta 2 decimales', () => {
    for (const tasa of ['0.01', '18.00', '18', '30.00', '30', '7.5']) {
      expect(tasaIgvEntradaSchema.safeParse({ tasa }).success, tasa).toBe(true);
    }
    for (const tasa of ['0', '0.00', '30.01', '31', '100', '18.001', '-1', '', 'x', 18]) {
      expect(tasaIgvEntradaSchema.safeParse({ tasa }).success, String(tasa)).toBe(false);
    }
  });
});

describe('turno, movimientos y cierre (criterios 24, 28 y 31)', () => {
  it('abrirTurnoEntrada: fondo de 0.00 a 99999999.99', () => {
    expect(
      abrirTurnoEntradaSchema.safeParse({ id: ID_1, cajaId: ID_2, fondo: '0.00' }).success,
    ).toBe(true);
    expect(
      abrirTurnoEntradaSchema.safeParse({ id: ID_1, cajaId: ID_2, fondo: '99999999.99' }).success,
    ).toBe(true);
    for (const malo of [
      { id: ID_1, cajaId: ID_2 },
      { id: ID_1, cajaId: ID_2, fondo: '-1.00' },
      { id: ID_1, cajaId: ID_2, fondo: '100000000.00' },
      { id: ID_1, cajaId: ID_2, fondo: '1.005' },
      { id: ID_1, cajaId: ID_2, fondo: 200 },
      { id: 'x', cajaId: ID_2, fondo: '1.00' },
      { id: ID_1, cajaId: ID_2, fondo: '1.00', responsableId: ID_3 },
    ]) {
      expect(abrirTurnoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('movimientoEntrada: monto mayor que 0 y motivo de 1 a 300', () => {
    const buena = { id: ID_1, tipo: 'EGRESO', monto: '15.50', motivo: 'Compra de hielo' };
    expect(movimientoEntradaSchema.safeParse(buena).success).toBe(true);
    for (const mala of [
      { ...buena, monto: '0.00' },
      { ...buena, monto: '0' },
      { ...buena, tipo: 'OTRO' },
      { ...buena, motivo: '' },
      { ...buena, motivo: 'a'.repeat(301) },
      { ...buena, medio: 'YAPE' },
    ]) {
      expect(movimientoEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });

  it('cierreEntrada: los cinco medios, una vez cada uno', () => {
    const conteo = ['EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'].map(
      (medio) => ({ medio, contado: '0.00' }),
    );
    expect(cierreEntradaSchema.safeParse({ conteo }).success).toBe(true);
    expect(
      cierreEntradaSchema.safeParse({
        conteo: conteo.map((c, i) =>
          i === 0 ? { ...c, contado: '287.00', motivo: 'Faltó sencillo' } : c,
        ),
      }).success,
    ).toBe(true);
    // Faltan medios, sobran, o se repite uno.
    expect(cierreEntradaSchema.safeParse({ conteo: conteo.slice(1) }).success).toBe(false);
    expect(cierreEntradaSchema.safeParse({ conteo: [...conteo, conteo[0]] }).success).toBe(false);
    const repetido = conteo.map((c, i) => (i === 4 ? { ...c, medio: 'YAPE' } : c));
    const resultado = cierreEntradaSchema.safeParse({ conteo: repetido });
    expect(resultado.success).toBe(false);
    expect(campos(resultado)).toContain('conteo.4.medio');
    expect(
      cierreEntradaSchema.safeParse({
        conteo: conteo.map((c, i) => (i === 1 ? { ...c, contado: '-1.00' } : c)),
      }).success,
    ).toBe(false);
  });
});

describe('descuentos y cortesías (criterios 38, 39 y 43)', () => {
  it('descuentoEntrada: por ítem o por cuenta (itemId null), con motivo', () => {
    const buena = {
      id: ID_1,
      itemId: ID_2,
      tipo: 'PORCENTAJE',
      valor: '10',
      motivo: 'Cliente frecuente',
    };
    expect(descuentoEntradaSchema.safeParse(buena).success).toBe(true);
    expect(
      descuentoEntradaSchema.safeParse({ ...buena, itemId: null, tipo: 'MONTO', valor: '5.00' })
        .success,
    ).toBe(true);
    for (const mala of [
      { ...buena, itemId: undefined },
      { ...buena, tipo: 'OTRO' },
      { ...buena, valor: '0' },
      { ...buena, valor: '-5' },
      { ...buena, valor: 10 },
      { ...buena, motivo: '' },
      { ...buena, autorizadoPor: ID_3 },
    ]) {
      expect(descuentoEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });

  it('cortesiaEntrada: cantidad entera de 1 a 999', () => {
    const buena = { id: ID_1, itemId: ID_2, cantidad: 1, motivo: 'Cumpleaños' };
    expect(cortesiaEntradaSchema.safeParse(buena).success).toBe(true);
    expect(cortesiaEntradaSchema.safeParse({ ...buena, cantidad: 999 }).success).toBe(true);
    for (const mala of [
      { ...buena, cantidad: 0 },
      { ...buena, cantidad: 1000 },
      { ...buena, cantidad: 1.5 },
      { ...buena, itemId: null },
      { ...buena, motivo: '  ' },
    ]) {
      expect(cortesiaEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });
});

describe('objetivo de una autorización (criterio 40)', () => {
  const descuento = {
    tipo: 'DESCUENTO',
    ordenId: ID_1,
    itemId: ID_2,
    descuento: { tipo: 'PORCENTAJE', valor: '10.00' },
  };
  const cortesia = { tipo: 'CORTESIA', ordenId: ID_1, itemId: ID_2, cantidad: 2 };

  it('acepta un objetivo de descuento (por ítem o por cuenta) o de cortesía', () => {
    expect(objetivoAutorizacionSchema.safeParse(descuento).success).toBe(true);
    expect(objetivoAutorizacionSchema.safeParse({ ...descuento, itemId: null }).success).toBe(true);
    expect(objetivoAutorizacionSchema.safeParse(cortesia).success).toBe(true);
  });

  it('rechaza un tipo desconocido, campos de más o de menos y valores mal formados', () => {
    for (const malo of [
      { ...descuento, tipo: 'OTRO' },
      { ...descuento, itemId: undefined },
      { ...descuento, cantidad: 1 },
      { ...descuento, descuento: { tipo: 'MONTO' } },
      { ...descuento, descuento: { tipo: 'MONTO', valor: '5', extra: 1 } },
      { ...cortesia, cantidad: 0 },
      { ...cortesia, itemId: null },
      { ...cortesia, descuento: { tipo: 'MONTO', valor: '5' } },
      {},
    ]) {
      expect(objetivoAutorizacionSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('la entrada de POST /autorizaciones lo acepta opcional y la respuesta lo devuelve', () => {
    const base = { accion: 'APLICAR_DESCUENTO', motivo: 'Descuento del 10 %', pin: '123456' };
    expect(autorizacionEntradaSchema.safeParse(base).success).toBe(true);
    expect(autorizacionEntradaSchema.safeParse({ ...base, objetivo: descuento }).success).toBe(
      true,
    );
    expect(autorizacionEntradaSchema.safeParse({ ...base, objetivo: { tipo: 'X' } }).success).toBe(
      false,
    );
    const respuesta = {
      autorizacionId: ID_3,
      accion: 'APLICAR_DESCUENTO',
      autorizadoPor: { id: ID_1, nombre: 'Sara' },
      expiraEn: '2026-11-04T20:02:00.000Z',
    };
    expect(autorizacionRespuestaSchema.safeParse(respuesta).success).toBe(true);
    expect(
      autorizacionRespuestaSchema.parse({ ...respuesta, objetivo: descuento }).objetivo,
    ).toEqual(descuento);
  });
});

describe('cobro (criterios 47, 50 y 51)', () => {
  const comprobante = { tipo: 'BOLETA', formato: 'DETALLADO' };
  const efectivo = { medio: 'EFECTIVO', monto: '33.30', recibido: '50.00' };
  const yape = { medio: 'YAPE', monto: '34.60', operacion: 'OP-123456' };
  const cobro = {
    id: ID_1,
    turnoId: ID_2,
    version: 3,
    total: '69.20',
    parte: { tipo: 'TOTAL' },
    comprobante,
    pagos: [efectivo, yape],
    redondeo: '0.04',
  };

  it('acepta un cobro con varios medios y las tres formas de parte', () => {
    expect(cobroEntradaSchema.safeParse(cobro).success).toBe(true);
    expect(
      cobroEntradaSchema.safeParse({ ...cobro, pagos: [], total: '0.00', redondeo: '0.00' })
        .success,
    ).toBe(true);
    expect(
      cobroEntradaSchema.safeParse({
        ...cobro,
        parte: { tipo: 'ITEMS', items: [{ itemId: ID_3, cantidad: 1 }] },
      }).success,
    ).toBe(true);
    expect(
      cobroEntradaSchema.safeParse({ ...cobro, parte: { tipo: 'IGUALES', partesRestantes: 2 } })
        .success,
    ).toBe(true);
  });

  it('rechaza campos desconocidos, el empresaId y formas incompletas', () => {
    for (const malo of [
      { ...cobro, empresaId: ID_1 },
      { ...cobro, creadoPorId: ID_1 },
      { ...cobro, version: 0 },
      { ...cobro, version: 1.5 },
      { ...cobro, total: 69.2 },
      { ...cobro, redondeo: undefined },
      { ...cobro, comprobante: undefined },
      { ...cobro, comprobante: { tipo: 'NOTA_CREDITO', formato: 'DETALLADO' } },
      { ...cobro, comprobante: { tipo: 'BOLETA', formato: 'RESUMEN' } },
      { ...cobro, pagos: Array.from({ length: 11 }, () => efectivo) },
    ]) {
      expect(cobroEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
    expect(
      cobroEntradaSchema.safeParse({ ...cobro, pagos: Array.from({ length: 10 }, () => efectivo) })
        .success,
    ).toBe(true);
  });

  it('parte: ITEMS de 1 a 200 con cantidad de 1 a 999; IGUALES de 1 a 50', () => {
    const item = { itemId: ID_1, cantidad: 1 };
    expect(
      parteEntradaSchema.safeParse({
        tipo: 'ITEMS',
        items: Array.from({ length: 200 }, () => item),
      }).success,
    ).toBe(true);
    for (const mala of [
      { tipo: 'ITEMS', items: [] },
      { tipo: 'ITEMS', items: Array.from({ length: 201 }, () => item) },
      { tipo: 'ITEMS', items: [{ itemId: ID_1, cantidad: 0 }] },
      { tipo: 'ITEMS', items: [{ itemId: ID_1, cantidad: 1000 }] },
      { tipo: 'ITEMS' },
      { tipo: 'IGUALES', partesRestantes: 0 },
      { tipo: 'IGUALES', partesRestantes: 51 },
      { tipo: 'IGUALES' },
      { tipo: 'TOTAL', partesRestantes: 1 },
      { tipo: 'MITAD' },
    ]) {
      expect(parteEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
    expect(parteEntradaSchema.safeParse({ tipo: 'IGUALES', partesRestantes: 50 }).success).toBe(
      true,
    );
  });

  it('pago: operación obligatoria fuera del efectivo y prohibida en el efectivo (400 con campos)', () => {
    for (const medio of ['TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN']) {
      const sin = pagoCobroEntradaSchema.safeParse({ medio, monto: '10.00' });
      expect(sin.success, medio).toBe(false);
      expect(campos(sin)).toEqual(['operacion']);
      expect(
        pagoCobroEntradaSchema.safeParse({ medio, monto: '10.00', operacion: 'A-1' }).success,
      ).toBe(true);
    }
    const conOperacion = pagoCobroEntradaSchema.safeParse({ ...efectivo, operacion: 'A-1' });
    expect(conOperacion.success).toBe(false);
    expect(campos(conOperacion)).toEqual(['operacion']);
    for (const operacion of ['', 'a b', 'a'.repeat(31), 'ñ1', 'a_b']) {
      expect(
        pagoCobroEntradaSchema.safeParse({ medio: 'YAPE', monto: '1.00', operacion }).success,
        operacion,
      ).toBe(false);
    }
    expect(
      pagoCobroEntradaSchema.safeParse({ medio: 'YAPE', monto: '1.00', operacion: 'a'.repeat(30) })
        .success,
    ).toBe(true);
  });

  it('pago: monto mayor que 0; los topes los pone el servicio (422), no el esquema', () => {
    expect(pagoCobroEntradaSchema.safeParse({ medio: 'EFECTIVO', monto: '0.00' }).success).toBe(
      false,
    );
    expect(pagoCobroEntradaSchema.safeParse({ medio: 'EFECTIVO', monto: '-1.00' }).success).toBe(
      false,
    );
    expect(pagoCobroEntradaSchema.safeParse({ medio: 'EFECTIVO', monto: '1.005' }).success).toBe(
      false,
    );
    // Hasta 12 enteros pasan el formato; el servicio responde 422 MONTO_FUERA_DE_RANGO (criterio 62).
    expect(
      pagoCobroEntradaSchema.safeParse({ medio: 'EFECTIVO', monto: '100000000.00' }).success,
    ).toBe(true);
    expect(
      pagoCobroEntradaSchema.safeParse({ medio: 'EFECTIVO', monto: '1'.repeat(13) }).success,
    ).toBe(false);
  });

  it('cliente: DNI de 8 dígitos, CE y pasaporte de 6 a 12 alfanuméricos y RUC válido', () => {
    const con = (cliente: unknown) =>
      cobroEntradaSchema.safeParse({ ...cobro, comprobante: { ...comprobante, cliente } });
    expect(con({ tipoDocumento: 'DNI', numero: '12345678', nombre: 'Ana Pérez' }).success).toBe(
      true,
    );
    expect(con({ tipoDocumento: 'CE', numero: 'AB1234', nombre: 'Ana' }).success).toBe(true);
    expect(con({ tipoDocumento: 'PASAPORTE', numero: 'X'.repeat(12), nombre: 'Ana' }).success).toBe(
      true,
    );
    expect(
      con({
        tipoDocumento: 'RUC',
        numero: '20100070970',
        nombre: 'Empresa SAC',
        direccion: 'Av. Lima 123',
      }).success,
    ).toBe(true);
    for (const malo of [
      { tipoDocumento: 'DNI', numero: '1234567', nombre: 'Ana' },
      { tipoDocumento: 'DNI', numero: '1234567a', nombre: 'Ana' },
      { tipoDocumento: 'CE', numero: 'AB123', nombre: 'Ana' },
      { tipoDocumento: 'PASAPORTE', numero: 'X'.repeat(13), nombre: 'Ana' },
      { tipoDocumento: 'RUC', numero: '20100070971', nombre: 'Empresa' },
      { tipoDocumento: 'RUC', numero: '123', nombre: 'Empresa' },
      { tipoDocumento: 'DNI', numero: '12345678', nombre: '' },
      { tipoDocumento: 'DNI', numero: '12345678', nombre: 'a'.repeat(201) },
      { tipoDocumento: 'DNI', numero: '12345678', nombre: 'Ana', direccion: 'a'.repeat(301) },
      { tipoDocumento: 'LE', numero: '12345678', nombre: 'Ana' },
    ]) {
      const resultado = con(malo);
      expect(resultado.success, JSON.stringify(malo)).toBe(false);
    }
    expect(campos(con({ tipoDocumento: 'DNI', numero: '123', nombre: 'Ana' }))).toEqual([
      'comprobante.cliente.numero',
    ]);
  });
});

describe('venta de mostrador (criterio 79)', () => {
  const linea = { productoId: ID_1, modificadorIds: [], cantidad: 2 };
  const venta = {
    id: ID_1,
    turnoId: ID_2,
    lineas: [linea],
    total: '56.00',
    comprobante: { tipo: 'BOLETA', formato: 'CONSUMO' },
    pagos: [{ medio: 'EFECTIVO', monto: '56.00' }],
    redondeo: '0.00',
  };

  it('acepta las líneas del envío de 004 y rechaza sin líneas, sin turno o con campos de más', () => {
    expect(ventaMostradorEntradaSchema.safeParse(venta).success).toBe(true);
    for (const mala of [
      { ...venta, lineas: [] },
      { ...venta, turnoId: undefined },
      { ...venta, version: 1 },
      { ...venta, lineas: [{ ...linea, cantidad: 0 }] },
      { ...venta, descuentos: [] },
    ]) {
      expect(ventaMostradorEntradaSchema.safeParse(mala).success, JSON.stringify(mala)).toBe(false);
    }
  });
});

describe('campos opcionales de 004 que gana 006 (criterios 44, 82 y 89)', () => {
  const orden = { id: ID_1, mesas: [], mozo: { id: ID_2, nombre: 'Lía' }, comensales: 2 };

  it('la pre-cuenta de 004 sigue valiendo y acepta descuentos, cortesías, pagado y porPagar', () => {
    const base = {
      id: ID_1,
      numero: 1,
      emitidaEn: '2026-11-04T20:00:00.000Z',
      orden,
      lineas: [],
      total: '10.00',
      nota: 'Precios con IGV incluido. No es un comprobante de pago.',
      impresion: 'SIN_IMPRESORA',
      trabajoId: null,
    };
    expect(precuentaRespuestaSchema.safeParse(base).success).toBe(true);
    const nueva = precuentaRespuestaSchema.safeParse({
      ...base,
      descuentos: [{ itemId: null, tipo: 'MONTO', valor: '5.00', monto: '5.00' }],
      cortesias: [{ itemId: ID_2, cantidad: 1, valorReferencial: '9.00' }],
      pagado: '37.00',
      porPagar: '32.20',
    });
    expect(nueva.success).toBe(true);
  });

  it('comandaKds acepta el número de llamado en la orden, y sin él sigue valiendo', () => {
    const comanda = {
      id: ID_1,
      tipo: 'COMANDA',
      creadaEn: '2026-11-04T20:00:00.000Z',
      vistaEn: null,
      motivo: null,
      estacion: { id: ID_2, nombre: 'Cocina' },
      orden,
      lineas: [],
    };
    expect(comandaKdsSchema.safeParse(comanda).success).toBe(true);
    const conLlamado = comandaKdsSchema.parse({
      ...comanda,
      orden: { ...orden, numeroLlamado: 23 },
    });
    expect(conLlamado.orden.numeroLlamado).toBe(23);
  });
});

describe('códigos de error de 006', () => {
  it('incluye los nuevos sin repetir ningún código', () => {
    for (const codigo of [
      'TURNO_YA_ABIERTO',
      'TURNO_CERRADO',
      'TURNO_AJENO',
      'CIERRE_BLOQUEADO',
      'CUENTA_CAMBIO',
      'CUENTA_EN_COBRO',
      'CUENTA_COBRADA_EN_PARTE',
      'NADA_QUE_COBRAR',
      'SIN_SERIE',
      'SERIE_AGOTADA',
      'TASA_IGV_NO_CONFIGURADA',
      'DIFERENCIA_SIN_MOTIVO',
      'DESCUENTO_INVALIDO',
      'CORTESIA_INVALIDA',
      'PARTE_INVALIDA',
      'PAGOS_NO_CUADRAN',
      'COMPROBANTE_NO_PERMITIDO',
      'CLIENTE_REQUERIDO',
    ]) {
      expect(CODIGOS_ERROR, codigo).toContain(codigo);
    }
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
  });

  it('errorRespuesta lleva turnoId, version, ordenes y las diferencias del arqueo, todos opcionales', () => {
    const base = { codigo: 'CUENTA_CAMBIO', mensaje: 'La cuenta cambió' };
    expect(errorRespuestaSchema.safeParse(base).success).toBe(true);
    const completo = errorRespuestaSchema.parse({
      ...base,
      turnoId: ID_1,
      version: 4,
      ordenes: 2,
      diferencias: [{ medio: 'EFECTIVO', contado: '287.00', diferencia: '-0.80' }],
    });
    expect(completo).toMatchObject({ turnoId: ID_1, version: 4, ordenes: 2 });
    expect(completo.diferencias).toHaveLength(1);
    expect(errorRespuestaSchema.safeParse({ ...base, ordenes: -1 }).success).toBe(false);
    expect(errorRespuestaSchema.safeParse({ ...base, version: 1.5 }).success).toBe(false);
  });
});
