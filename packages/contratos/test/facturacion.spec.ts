import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERROR,
  alertasRespuestaSchema,
  autorizacionEntradaSchema,
  comprobanteDetalleSchema,
  configuracionPseEntradaSchema,
  configuracionPseRespuestaSchema,
  errorRespuestaSchema,
  eventoComprobanteEstadoSchema,
  eventoFacturacionAlertaSchema,
  notaCreditoEntradaSchema,
  objetivoAutorizacionSchema,
  padronRucParametroSchema,
  panelComprobantesSchema,
  panelConsultaSchema,
  pagoDevolucionEntradaSchema,
  reemisionEntradaSchema,
  reporteCajaSchema,
  movimientoRespuestaSchema,
} from '../src';

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';
const RUC = '20100070970';

const clienteFactura = {
  tipoDocumento: 'RUC',
  numero: RUC,
  nombre: 'Empresa SAC',
  direccion: 'Av. Lima 123',
};

const devolucion = {
  turnoId: ID_2,
  pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
  redondeo: '0.00',
};

describe('notaCreditoEntrada (criterio 144)', () => {
  const base = {
    id: ID_1,
    comprobanteId: ID_2,
    tipo: 'DEVOLUCION',
    motivo: 'Producto devuelto',
    total: '28.00',
    lineas: [{ posicion: 1, cantidad: 1 }],
    devolucion,
  };

  it('acepta una devolución con líneas y devolución, con o sin dinero devuelto', () => {
    expect(notaCreditoEntradaSchema.safeParse(base).success).toBe(true);
    expect(notaCreditoEntradaSchema.safeParse({ ...base, devolucion: null }).success).toBe(true);
    const sin: Record<string, unknown> = { ...base };
    delete sin.devolucion;
    expect(notaCreditoEntradaSchema.safeParse(sin).success).toBe(true);
  });

  it('acepta una anulación sin líneas y un cambio a factura con cliente', () => {
    const anulacion: Record<string, unknown> = { ...base, tipo: 'ANULACION' };
    delete anulacion.lineas;
    expect(notaCreditoEntradaSchema.safeParse(anulacion).success).toBe(true);
    const cambio: Record<string, unknown> = {
      ...anulacion,
      tipo: 'CAMBIO_A_FACTURA',
      cliente: clienteFactura,
    };
    delete cambio.devolucion;
    expect(notaCreditoEntradaSchema.safeParse(cambio).success).toBe(true);
  });

  it('exige las líneas solo en la devolución, el cliente solo en el cambio y nada de dinero en el cambio', () => {
    const sinLineas: Record<string, unknown> = { ...base };
    delete sinLineas.lineas;
    for (const malo of [
      sinLineas,
      { ...base, tipo: 'ANULACION' },
      { ...base, cliente: clienteFactura },
      { ...base, tipo: 'CAMBIO_A_FACTURA', lineas: undefined },
      { ...base, tipo: 'CAMBIO_A_FACTURA', lineas: undefined, cliente: clienteFactura },
    ]) {
      expect(notaCreditoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('rechaza campos desconocidos, motivo vacío, líneas vacías o de más y cantidades fuera de rango', () => {
    for (const malo of [
      { ...base, empresaId: ID_3 },
      { ...base, motivo: '  ' },
      { ...base, motivo: 'x'.repeat(301) },
      { ...base, lineas: [] },
      {
        ...base,
        lineas: Array.from({ length: 201 }, (_, i) => ({ posicion: i + 1, cantidad: 1 })),
      },
      { ...base, lineas: [{ posicion: 0, cantidad: 1 }] },
      { ...base, lineas: [{ posicion: 1, cantidad: 1000 }] },
      { ...base, lineas: [{ posicion: 1, cantidad: 1, extra: true }] },
      { ...base, total: '28.001' },
      { ...base, tipo: 'OTRO' },
      { ...base, id: 'no-es-uuid' },
    ]) {
      expect(notaCreditoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('valida la devolución: de 1 a 5 pagos, operación fuera del efectivo y prohibida en el efectivo', () => {
    const pago = { medio: 'YAPE', monto: '10.00', operacion: 'OP-1' };
    expect(pagoDevolucionEntradaSchema.safeParse(pago).success).toBe(true);
    for (const malo of [
      { ...pago, operacion: undefined },
      { medio: 'EFECTIVO', monto: '10.00', operacion: 'OP-1' },
      { ...pago, recibido: '10.00' },
      { ...pago, monto: '0.00' },
      { ...pago, operacion: 'con espacios' },
    ]) {
      expect(pagoDevolucionEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
    for (const malo of [
      { ...base, devolucion: { ...devolucion, pagos: [] } },
      { ...base, devolucion: { ...devolucion, pagos: Array(6).fill(devolucion.pagos[0]) } },
      { ...base, devolucion: { ...devolucion, turnoId: 'x' } },
      { ...base, devolucion: { ...devolucion, extra: 1 } },
    ]) {
      expect(notaCreditoEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('reemisionEntrada (criterio 134)', () => {
  it('acepta boleta, factura con cliente y una nota sin cliente', () => {
    expect(reemisionEntradaSchema.safeParse({ tipo: 'BOLETA' }).success).toBe(true);
    expect(
      reemisionEntradaSchema.safeParse({ tipo: 'FACTURA', cliente: clienteFactura }).success,
    ).toBe(true);
    expect(reemisionEntradaSchema.safeParse({ tipo: 'NOTA_CREDITO_FACTURA' }).success).toBe(true);
  });

  it('rechaza el cliente en una nota, campos desconocidos y un RUC inválido', () => {
    for (const malo of [
      { tipo: 'NOTA_CREDITO_BOLETA', cliente: clienteFactura },
      { tipo: 'FACTURA', extra: 1 },
      { tipo: 'FACTURA', cliente: { ...clienteFactura, numero: '20100070971' } },
      { tipo: 'PEDIDO' },
      {},
    ]) {
      expect(reemisionEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('panelConsulta (criterio 135)', () => {
  it('acepta uno o varios estados (repetidos o separados por comas) y los normaliza a una lista', () => {
    const uno = panelConsultaSchema.parse({ estado: 'RECHAZADO' });
    expect(uno.estado).toEqual(['RECHAZADO']);
    expect(panelConsultaSchema.parse({ estado: 'RECHAZADO,ENVIADO' }).estado).toEqual([
      'RECHAZADO',
      'ENVIADO',
    ]);
    expect(panelConsultaSchema.parse({ estado: ['ACEPTADO', 'ANULADO'] }).estado).toEqual([
      'ACEPTADO',
      'ANULADO',
    ]);
  });

  it('lee alerta como booleano y acepta todos los filtros', () => {
    const consulta = panelConsultaSchema.parse({
      tipo: 'NOTA_CREDITO_BOLETA',
      desde: '2026-11-01',
      hasta: '2026-11-06',
      alerta: 'true',
      texto: 'B001-124',
      sucursalId: ID_1,
      cursor: 'abc_DEF-123',
    });
    expect(consulta.alerta).toBe(true);
    expect(panelConsultaSchema.parse({}).alerta).toBeUndefined();
  });

  it('rechaza estados desconocidos, fechas imposibles, alerta rara y campos desconocidos', () => {
    for (const malo of [
      { estado: 'PENDIENTE' },
      { estado: '' },
      { desde: '2026-02-30' },
      { alerta: 'si' },
      { sucursalId: 'x' },
      { texto: '' },
      { otro: 1 },
    ]) {
      expect(panelConsultaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('respuestas de facturación', () => {
  const envio = {
    estado: 'ESPERANDO_RESPUESTA',
    intentos: 2,
    proximoIntentoEn: '2026-11-06T15:00:00.000Z',
    plazoHasta: '2026-11-09T04:59:59.999Z',
    ultimoResultado: 'PENDIENTE',
    ultimoError: null,
  };

  it('el panel lleva conteos por estado, ítems con alerta y cursor', () => {
    const panel = {
      conteos: { POR_ENVIAR: 1, ENVIADO: 0, ACEPTADO: 10, RECHAZADO: 2, ANULADO: 0 },
      items: [
        {
          id: ID_1,
          tipo: 'FACTURA',
          numero: 'F001-00000001',
          estado: 'RECHAZADO',
          simulado: false,
          total: '118.00',
          fechaEmision: '2026-11-06',
          emitidoEn: '2026-11-06T15:00:00.000Z',
          cliente: 'Empresa SAC',
          sucursal: { id: ID_2, nombre: 'Miraflores' },
          alerta: 'RECHAZADO',
          envio: { ...envio, estado: 'TERMINADO', ultimoResultado: 'RECHAZADO' },
          sunat: { codigo: '2335', mensaje: 'RUC del receptor no existe' },
          afectaA: null,
          reemplazaA: null,
          reemplazadoPor: null,
        },
      ],
      siguiente: null,
    };
    expect(panelComprobantesSchema.safeParse(panel).success).toBe(true);
    expect(
      panelComprobantesSchema.safeParse({
        ...panel,
        items: [{ ...panel.items[0], alerta: 'OTRA' }],
      }).success,
    ).toBe(false);
  });

  it('las alertas llevan cuatro conteos y el aviso de modo simulado', () => {
    expect(
      alertasRespuestaSchema.safeParse({
        rechazados: 2,
        demorados: 1,
        detenidos: 0,
        sinConfiguracion: 0,
        modoSimulado: true,
      }).success,
    ).toBe(true);
    expect(alertasRespuestaSchema.safeParse({ rechazados: -1 }).success).toBe(false);
  });

  it('el detalle de un comprobante es el comprobante más su envío y hasta 50 intentos', () => {
    expect(Object.keys(comprobanteDetalleSchema.shape)).toEqual(
      expect.arrayContaining(['id', 'lineas', 'envio', 'intentos']),
    );
  });
});

describe('configuración del PSE (criterios 122 y 123)', () => {
  it('acepta el modo solo, con una credencial de 1 a 5 campos o con null para borrarla', () => {
    expect(configuracionPseEntradaSchema.safeParse({ modo: 'SIMULADO' }).success).toBe(true);
    expect(
      configuracionPseEntradaSchema.safeParse({ modo: 'REAL', credencial: { token: 'abc' } })
        .success,
    ).toBe(true);
    expect(
      configuracionPseEntradaSchema.safeParse({ modo: 'SIMULADO', credencial: null }).success,
    ).toBe(true);
  });

  it('rechaza credenciales vacías, de más de 5 campos, con nombres o valores inválidos y campos desconocidos', () => {
    const seis = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, 'x']));
    for (const malo of [
      { modo: 'REAL', credencial: {} },
      { modo: 'REAL', credencial: seis },
      { modo: 'REAL', credencial: { Token: 'x' } },
      { modo: 'REAL', credencial: { '1token': 'x' } },
      { modo: 'REAL', credencial: { token: '' } },
      { modo: 'REAL', credencial: { token: 'x'.repeat(2001) } },
      { modo: 'REAL', credencial: { ['a'.repeat(41)]: 'x' } },
      { modo: 'PRUEBA' },
      { modo: 'REAL', otro: 1 },
      {},
    ]) {
      expect(configuracionPseEntradaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(
        false,
      );
    }
  });

  it('la respuesta nunca tiene dónde poner el valor de la credencial', () => {
    expect(Object.keys(configuracionPseRespuestaSchema.shape).sort()).toEqual([
      'actualizadaEn',
      'camposCredencial',
      'conector',
      'credencialConfigurada',
      'emisorId',
      'modo',
    ]);
    expect(
      configuracionPseRespuestaSchema.safeParse({
        emisorId: ID_1,
        modo: 'SIMULADO',
        conector: null,
        credencialConfigurada: true,
        camposCredencial: ['token'],
        actualizadaEn: '2026-11-06T15:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('padrón (criterios 138 y 139)', () => {
  it('el parámetro es un RUC de 11 dígitos con dígito verificador válido', () => {
    expect(padronRucParametroSchema.safeParse(RUC).success).toBe(true);
    for (const malo of ['2010007097', '20100070971', '2010007097a', '', '20%']) {
      expect(padronRucParametroSchema.safeParse(malo).success, malo).toBe(false);
    }
  });

  it('un RUC mal formado falla en el campo `ruc` (no con el campo vacío)', () => {
    for (const malo of ['2010007097', '20100070971', 'abcdefghijk', '', '20%']) {
      const resultado = padronRucParametroSchema.safeParse(malo);
      expect(resultado.success, malo).toBe(false);
      if (!resultado.success) {
        expect(
          resultado.error.issues.map((i) => i.path.join('.')),
          malo,
        ).toEqual(['ruc']);
      }
    }
  });
});

describe('autorización de una nota de crédito (criterio 145)', () => {
  const objetivo = {
    tipo: 'NOTA_CREDITO',
    comprobanteId: ID_1,
    tipoNota: 'DEVOLUCION',
    total: '28.00',
    devuelto: '28.00',
  };

  it('el objetivo se ensancha con la variante NOTA_CREDITO y las anteriores siguen igual', () => {
    expect(objetivoAutorizacionSchema.safeParse(objetivo).success).toBe(true);
    expect(
      autorizacionEntradaSchema.safeParse({
        accion: 'EMITIR_NOTA_CREDITO',
        motivo: 'Devolución',
        pin: '123456',
        objetivo,
      }).success,
    ).toBe(true);
    expect(
      objetivoAutorizacionSchema.safeParse({
        tipo: 'CORTESIA',
        ordenId: ID_1,
        itemId: ID_2,
        cantidad: 1,
      }).success,
    ).toBe(true);
  });

  it('rechaza un tipo de nota desconocido, montos mal escritos y campos de más', () => {
    for (const malo of [
      { ...objetivo, tipoNota: 'OTRA' },
      { ...objetivo, total: '28,00' },
      { ...objetivo, devuelto: undefined },
      { ...objetivo, extra: 1 },
      { ...objetivo, comprobanteId: 'x' },
    ]) {
      expect(objetivoAutorizacionSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });
});

describe('reporte de caja, movimientos y errores con 6b', () => {
  it('los movimientos admiten el medio y la nota de crédito; el reporte, sus notas', () => {
    const movimiento = {
      id: ID_1,
      tipo: 'EGRESO',
      monto: '28.00',
      motivo: 'Devolución NC BC01-00000003',
      creadoEn: '2026-11-06T15:00:00.000Z',
      creadoPor: null,
    };
    expect(movimientoRespuestaSchema.safeParse(movimiento).success).toBe(true);
    expect(
      movimientoRespuestaSchema.safeParse({ ...movimiento, medio: 'YAPE', comprobanteId: ID_2 })
        .success,
    ).toBe(true);
    expect(movimientoRespuestaSchema.safeParse({ ...movimiento, medio: 'CHEQUE' }).success).toBe(
      false,
    );
    expect(Object.keys(reporteCajaSchema.shape)).toContain('notasCredito');
  });

  it('los códigos nuevos de 6b existen una sola vez y el error puede traer el comprobante', () => {
    for (const codigo of [
      'ENVIO_TERMINADO',
      'COMPROBANTE_NO_RECHAZADO',
      'YA_REEMPLAZADO',
      'COMPROBANTE_NO_ACEPTADO',
      'COMPROBANTE_ANULADO',
      'NOTA_CREDITO_CAMBIO',
      'PDF_NO_DISPONIBLE',
      'PSE_NO_CONFIGURADO',
      'MODO_PSE_INVALIDO',
      'NOTA_CREDITO_INVALIDA',
      'NADA_QUE_ACREDITAR',
      'DEVOLUCION_INVALIDA',
      'RUC_NO_ENCONTRADO',
      'PADRON_NO_DISPONIBLE',
    ]) {
      expect(
        CODIGOS_ERROR.filter((c) => c === codigo),
        codigo,
      ).toHaveLength(1);
    }
    expect(new Set(CODIGOS_ERROR).size).toBe(CODIGOS_ERROR.length);
    expect(
      errorRespuestaSchema.safeParse({
        codigo: 'YA_REEMPLAZADO',
        mensaje: 'Ya tiene reemisión',
        comprobanteId: ID_1,
      }).success,
    ).toBe(true);
  });
});

describe('eventos de 6b (criterio 172)', () => {
  it('comprobante.estado lleva solo ids y el estado; facturacion.alerta, la sucursal', () => {
    const sala = { tipo: 'sucursal', sucursalId: ID_2 };
    expect(
      eventoComprobanteEstadoSchema.safeParse({
        empresaId: ID_1,
        sala,
        nombre: 'comprobante.estado',
        datos: { comprobanteId: ID_3, estado: 'ACEPTADO', sucursalId: ID_2 },
      }).success,
    ).toBe(true);
    expect(
      eventoFacturacionAlertaSchema.safeParse({
        empresaId: ID_1,
        sala,
        nombre: 'facturacion.alerta',
        datos: { sucursalId: ID_2 },
      }).success,
    ).toBe(true);
    expect(
      eventoComprobanteEstadoSchema.safeParse({
        empresaId: ID_1,
        sala,
        nombre: 'comprobante.estado',
        datos: { comprobanteId: ID_3, estado: 'LISTO', sucursalId: ID_2 },
      }).success,
    ).toBe(false);
  });
});
