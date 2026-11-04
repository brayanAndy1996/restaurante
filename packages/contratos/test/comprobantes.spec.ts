import { describe, expect, it } from 'vitest';
import {
  clienteComprobanteEntradaSchema,
  comprobanteEntradaSchema,
  comprobanteRespuestaSchema,
  comprobanteResumenSchema,
  comprobantesConsultaSchema,
  impresionDeCajaRespuestaSchema,
} from '../src';

// Esquemas de los comprobantes (historia 006, entrega 6a): formato de los datos, no reglas de negocio.

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';

describe('comprobanteEntrada (criterio 51)', () => {
  it('tipo BOLETA o FACTURA, formato DETALLADO o CONSUMO y cliente opcional', () => {
    expect(
      comprobanteEntradaSchema.safeParse({ tipo: 'BOLETA', formato: 'DETALLADO' }).success,
    ).toBe(true);
    expect(
      comprobanteEntradaSchema.safeParse({ tipo: 'FACTURA', formato: 'CONSUMO' }).success,
    ).toBe(true);
    for (const malo of [
      {},
      { tipo: 'BOLETA' },
      { formato: 'DETALLADO' },
      { tipo: 'NOTA_CREDITO_BOLETA', formato: 'DETALLADO' },
      { tipo: 'BOLETA', formato: 'RESUMEN' },
      { tipo: 'BOLETA', formato: 'DETALLADO', serie: 'B001' },
      { tipo: 'BOLETA', formato: 'DETALLADO', cliente: null },
    ]) {
      expect(comprobanteEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('el cliente recorta los espacios y acepta una dirección opcional', () => {
    const cliente = clienteComprobanteEntradaSchema.parse({
      tipoDocumento: 'RUC',
      numero: '20100070970',
      nombre: '  Distribuidora SAC  ',
      direccion: ' Av. Lima 123 ',
    });
    expect(cliente.nombre).toBe('Distribuidora SAC');
    expect(cliente.direccion).toBe('Av. Lima 123');
  });
});

const linea = {
  posicion: 1,
  itemId: ID_2,
  descripcion: 'Lomo saltado [3/4]',
  cantidad: 2,
  unidad: 'NIU',
  precioUnitario: '28.00',
  valorUnitario: '23.7288135593',
  bruto: '56.00',
  descuento: '0.00',
  neto: '56.00',
  base: '47.46',
  igv: '8.54',
  bolsas: 0,
  icbper: '0.00',
  afectacion: 'GRAVADO',
  gratuita: false,
  valorReferencial: null,
};

const comprobante = {
  id: ID_1,
  tipo: 'BOLETA',
  serie: 'B001',
  correlativo: 124,
  numero: 'B001-00000124',
  formato: 'DETALLADO',
  estado: 'POR_ENVIAR',
  fechaEmision: '2026-11-05',
  emitidoEn: '2026-11-05T07:00:00.000Z',
  diaOperativo: '2026-11-04',
  emisor: { ruc: '20100070970', razonSocial: 'Fogón SAC', regimen: 'GENERAL' },
  sucursal: { nombre: 'Miraflores', direccion: 'Av. Larco 100', codigoEstablecimiento: '0001' },
  cajaId: ID_2,
  turnoId: ID_3,
  turnoResponsableId: ID_1,
  cobroId: ID_3,
  numeroParte: 1,
  cliente: null,
  moneda: 'PEN',
  tasaIgv: '18.00',
  lineas: [linea],
  totales: {
    subtotal: '56.00',
    descuentos: '0.00',
    operaciones: { gravadas: '47.46', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
    igv: '8.54',
    igvGratuitas: '0.00',
    icbper: '0.00',
    total: '56.00',
  },
  montoEnLetras: 'CINCUENTA Y SEIS CON 00/100 SOLES',
  orden: { id: ID_1, mesas: ['4'], mozo: 'Lía', numeroLlamado: null },
};

describe('comprobanteRespuesta (criterios 69 y 77)', () => {
  it('acepta un comprobante de una boleta con su desglose', () => {
    expect(comprobanteRespuestaSchema.safeParse(comprobante).success).toBe(true);
  });

  it('acepta un emisor Nuevo RUS (sin tasa ni operaciones), un cliente y una venta de mostrador', () => {
    expect(
      comprobanteRespuestaSchema.safeParse({
        ...comprobante,
        emisor: { ...comprobante.emisor, regimen: 'NUEVO_RUS' },
        tasaIgv: null,
        totales: { ...comprobante.totales, operaciones: null },
        cliente: { tipoDocumento: 'DNI', numero: '12345678', nombre: 'Ana', direccion: null },
        orden: { id: ID_1, mesas: [], mozo: null, numeroLlamado: 23 },
      }).success,
    ).toBe(true);
  });

  it('rechaza una moneda distinta de PEN, un estado desconocido y un tipo que no es boleta ni factura', () => {
    for (const malo of [
      { ...comprobante, moneda: 'USD' },
      { ...comprobante, estado: 'PENDIENTE' },
      { ...comprobante, tipo: 'NOTA_CREDITO_BOLETA' },
      { ...comprobante, correlativo: 0 },
      { ...comprobante, numeroParte: 0 },
      { ...comprobante, lineas: [{ ...linea, unidad: 'KGM' }] },
    ]) {
      expect(comprobanteRespuestaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('resumen, consulta e impresión', () => {
  it('comprobanteResumen', () => {
    expect(
      comprobanteResumenSchema.safeParse({
        id: ID_1,
        tipo: 'FACTURA',
        numero: 'F001-00000007',
        estado: 'POR_ENVIAR',
        total: '118.00',
        emitidoEn: '2026-11-05T07:00:00.000Z',
        cliente: 'Distribuidora SAC',
        cajaId: ID_2,
        turnoId: ID_3,
        ordenId: null,
      }).success,
    ).toBe(true);
  });

  it('comprobantesConsulta: turnoId y ordenId opcionales y ningún otro filtro', () => {
    expect(comprobantesConsultaSchema.safeParse({}).success).toBe(true);
    expect(comprobantesConsultaSchema.safeParse({ turnoId: ID_1, ordenId: ID_2 }).success).toBe(
      true,
    );
    expect(comprobantesConsultaSchema.safeParse({ turnoId: 'x' }).success).toBe(false);
    expect(comprobantesConsultaSchema.safeParse({ estado: 'RECHAZADO' }).success).toBe(false);
  });

  it('impresionDeCajaRespuesta: trabajo o sin impresora', () => {
    expect(
      impresionDeCajaRespuestaSchema.safeParse({ trabajoId: ID_1, impresion: 'EN_COLA' }).success,
    ).toBe(true);
    expect(
      impresionDeCajaRespuestaSchema.safeParse({ trabajoId: null, impresion: 'SIN_IMPRESORA' })
        .success,
    ).toBe(true);
    expect(
      impresionDeCajaRespuestaSchema.safeParse({ trabajoId: null, impresion: 'OTRO' }).success,
    ).toBe(false);
  });
});
