import { montoEnLetras } from '@restaurante/dominio';
import { describe, expect, it } from 'vitest';
import {
  documentoDeComprobante,
  documentoDeGaveta,
  documentoDeReporteCaja,
  textoDelQr,
  renderizarTicket,
  type ComprobanteParaTicket,
  type ContextoDeComprobante,
  type ReporteParaTicket,
} from '../../../src/modulos/impresion/escpos';
import { interpretarEscPos } from '../../soporte/puente/interprete-escpos';
import { ANCHOS, columnasDe, imprimir, sinTildes, textos } from './ayudas-escpos';

// Historia 006, T21 (no protegida): el contenido del ticket del comprobante (criterio 91) en 58 y 80 mm y con
// `SIN_TILDES`, el reporte X y la Z (criterio 95), y los bloques `qr` y `gaveta` del renderizador y del emulador.

function comprobante(extra: Partial<ComprobanteParaTicket> = {}): ComprobanteParaTicket {
  return {
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 124,
    numero: 'B001-00000124',
    fechaEmision: '2026-11-02',
    emisor: { ruc: '20123456789', razonSocial: 'Cevichería Ñandú Café S.A.C.' },
    sucursal: { nombre: 'Miraflores', direccion: 'Av. José Larco 123, Miraflores, Lima' },
    cliente: null,
    tasaIgv: '18.00',
    lineas: [
      {
        cantidad: 2,
        descripcion: 'Lomo saltado [3/4]',
        bruto: '56.00',
        descuento: '0.00',
        gratuita: false,
      },
      { cantidad: 1, descripcion: 'Gaseosa', bruto: '9.00', descuento: '1.00', gratuita: false },
      {
        cantidad: 1,
        descripcion: 'Postre de la casa',
        bruto: '0.00',
        descuento: '0.00',
        gratuita: true,
      },
    ],
    totales: {
      descuentos: '1.00',
      operaciones: { gravadas: '54.24', exoneradas: '0.00', inafectas: '0.00', gratuitas: '7.00' },
      igv: '9.76',
      icbper: '0.50',
      total: '64.50',
    },
    montoEnLetras: montoEnLetras('64.50'),
    orden: { mesas: ['Mesa 4', 'Mesa 5'], mozo: 'Rosa Quispe', numeroLlamado: null },
    ...extra,
  };
}

const contexto = (extra: Partial<ContextoDeComprobante> = {}): ContextoDeComprobante => ({
  hora: '20:15',
  pagos: [
    { medio: 'YAPE', monto: '14.50', recibido: null },
    { medio: 'EFECTIVO', monto: '50.00', recibido: '100.00' },
  ],
  vuelto: '50.00',
  redondeo: '0.00',
  abreGaveta: false,
  ...extra,
});

describe('criterio 91 · el ticket del comprobante', () => {
  it.each(ANCHOS)('lleva todo lo que pide el criterio en %i mm', (ancho) => {
    const ticket = imprimir(documentoDeComprobante(comprobante(), contexto()), ancho, 'PC850');
    const t = ticket.texto;
    for (const esperado of [
      'Cevichería Ñandú Café S.A.C.',
      'RUC: 20123456789',
      'Miraflores',
      'BOLETA DE VENTA ELECTRÓNICA',
      'B001-00000124',
      '02/11/2026',
      '20:15',
      'Mesas 4 + 5',
      'Mozo: Rosa Quispe',
      'Lomo saltado [3/4]',
      'Descuento',
      'Cortesía',
      'Op. gravadas',
      'Op. gratuitas',
      'IGV (18%)',
      'ICBPER',
      'TOTAL S/',
      '64.50',
      'SON: SESENTA Y CUATRO CON 50/100 SOLES',
      'Yape',
      'Efectivo',
      'Recibido',
      'Vuelto',
      'Comprobante pendiente de envío a SUNAT',
    ]) {
      expect(sinEspacios(t), esperado).toContain(sinEspacios(esperado));
    }
    expect(ticket.qrs).toEqual([textoDelQr(comprobante())]);
    expect(ticket.qrs[0]).toBe('20123456789|03|B001|00000124|9.76|64.50|2026-11-02|0|-|');
  });

  it('no escribe líneas que pasen del ancho ni comandos que la impresora no entienda en 58 mm', () => {
    const ticket = imprimir(documentoDeComprobante(comprobante(), contexto()), 58, 'PC850');
    for (const l of textos(ticket)) expect(l.length).toBeLessThanOrEqual(columnasDe(58));
  });

  it('con SIN_TILDES solo escribe ASCII y el texto es el mismo sin tildes', () => {
    for (const ancho of ANCHOS) {
      const con = imprimir(documentoDeComprobante(comprobante(), contexto()), ancho, 'PC850');
      const sin = imprimir(documentoDeComprobante(comprobante(), contexto()), ancho, 'SIN_TILDES');
      expect(sin.texto).toMatch(/^[\n -~]*$/);
      expect(sinEspacios(sin.texto)).toBe(sinEspacios(sinTildes(con.texto)));
      expect(sin.texto).toContain('Cevicheria');
    }
  });

  it('un comprobante de mostrador lleva LLAMADO 23 en grande y no la mesa ni el mozo', () => {
    const doc = documentoDeComprobante(
      comprobante({ orden: { mesas: [], mozo: null, numeroLlamado: 23 } }),
      contexto(),
    );
    const ticket = imprimir(doc, 80, 'PC850');
    const llamado = ticket.lineas.find((l) => l.texto.includes('LLAMADO 23'));
    expect(llamado).toBeDefined();
    expect(llamado!.dobleAlto).toBe(true);
    expect(ticket.texto).not.toContain('Mozo');
    expect(ticket.texto).not.toContain('Mesa');
  });

  it('una factura lleva el cliente con su RUC y su dirección, y la tasa 10.50 con sus decimales', () => {
    const doc = documentoDeComprobante(
      comprobante({
        tipo: 'FACTURA',
        serie: 'F001',
        numero: 'F001-00000007',
        correlativo: 7,
        tasaIgv: '10.50',
        cliente: {
          tipoDocumento: 'RUC',
          numero: '20555555551',
          nombre: 'Distribuidora Andina S.A.',
          direccion: 'Jr. Unión 45, Lima',
        },
      }),
      contexto(),
    );
    const ticket = imprimir(doc, 80, 'PC850');
    expect(ticket.texto).toContain('FACTURA ELECTRÓNICA');
    expect(ticket.texto).toContain('Cliente: Distribuidora Andina S.A.');
    expect(ticket.texto).toContain('RUC: 20555555551');
    expect(ticket.texto).toContain('Dirección: Jr. Unión 45, Lima');
    expect(ticket.texto).toContain('IGV (10.50%)');
    expect(ticket.qrs[0]).toBe('20123456789|01|F001|00000007|9.76|64.50|2026-11-02|6|20555555551|');
  });

  it('con un emisor Nuevo RUS (sin operaciones) no desglosa el IGV y el redondeo se muestra', () => {
    const doc = documentoDeComprobante(
      comprobante({
        tasaIgv: null,
        totales: {
          descuentos: '0.00',
          operaciones: null,
          igv: '0.00',
          icbper: '0.00',
          total: '33.34',
        },
      }),
      contexto({
        pagos: [{ medio: 'EFECTIVO', monto: '33.30', recibido: '50.00' }],
        redondeo: '0.04',
        vuelto: '16.70',
      }),
    );
    const ticket = imprimir(doc, 80, 'PC850');
    expect(ticket.texto).not.toContain('IGV');
    expect(ticket.texto).not.toContain('Op. gravadas');
    expect(sinEspacios(ticket.texto)).toContain('Redondeo-0.04');
  });

  it('el QR nunca pasa de 300 caracteres ni lleva barras del cliente', () => {
    const texto = textoDelQr(
      comprobante({
        cliente: {
          tipoDocumento: 'DNI',
          numero: `1${'|'.repeat(400)}`,
          nombre: 'X',
          direccion: null,
        },
      }),
    );
    expect(Array.from(texto).length).toBeLessThanOrEqual(300);
    expect(texto.split('|')).toHaveLength(10);
  });

  it('el pulso de la gaveta va antes del primer texto y solo si el renderizador lo pide', () => {
    const doc = documentoDeComprobante(comprobante(), contexto({ abreGaveta: true }));
    expect(doc.bloques[0]).toEqual({ tipo: 'gaveta' });
    const con = interpretarEscPos(
      renderizarTicket(doc, { anchoMm: 80, juegoCaracteres: 'PC850', pulsoGaveta: true }),
      { columnas: 48 },
    ).tickets[0]!;
    expect(con.pulsosGaveta).toBe(1);
    const lineas = con.marcado.split('\n');
    const pulso = lineas.findIndex((l) => l === '[GAVETA]');
    const primerTexto = lineas.findIndex((l) => l.includes('Cevicher'));
    expect(pulso).toBeGreaterThan(0);
    expect(pulso).toBeLessThan(primerTexto);

    for (const sin of [
      { anchoMm: 80 as const, juegoCaracteres: 'PC850' as const },
      { anchoMm: 80 as const, juegoCaracteres: 'PC850' as const, pulsoGaveta: false },
    ]) {
      const ticket = interpretarEscPos(renderizarTicket(doc, sin), { columnas: 48 }).tickets[0]!;
      expect(ticket.pulsosGaveta).toBe(0);
      expect(ticket.marcado).not.toContain('[GAVETA]');
    }
  });
});

describe('criterio 93 · el documento de la gaveta', () => {
  it('es solo el pulso: sin texto, sin avance y sin corte', () => {
    const bytes = renderizarTicket(documentoDeGaveta(), {
      anchoMm: 58,
      juegoCaracteres: 'PC850',
      pulsoGaveta: true,
    });
    const { tickets, parcial } = interpretarEscPos(bytes);
    expect(tickets).toEqual([]);
    expect(parcial).not.toBeNull();
    expect(parcial!.pulsosGaveta).toBe(1);
    expect(parcial!.lineas).toEqual([]);
    expect(parcial!.corte).toBeNull();
    expect(parcial!.avance).toBe(0);
    expect(parcial!.comandosDesconocidos).toEqual([]);
    expect([...bytes.slice(-5)]).toEqual([0x1b, 0x70, 0, 25, 250]);
  });

  it('sin el permiso del pulso no manda ninguno', () => {
    const bytes = renderizarTicket(documentoDeGaveta(), { anchoMm: 58, juegoCaracteres: 'PC850' });
    expect(interpretarEscPos(bytes).parcial?.pulsosGaveta ?? 0).toBe(0);
  });
});

describe('el bloque qr', () => {
  it('manda GS ( k modelo 2, corrección M, datos e impresión, y el emulador lo decodifica', () => {
    const doc = documentoDeComprobante(comprobante(), contexto());
    const bytes = renderizarTicket(doc, { anchoMm: 58, juegoCaracteres: 'PC850' });
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(hex).toContain('1d 28 6b 04 00 31 41 32 00');
    expect(hex).toContain('1d 28 6b 03 00 31 45 31');
    expect(hex).toContain('1d 28 6b 03 00 31 51 30');
    const { tickets } = interpretarEscPos(bytes, { columnas: 32 });
    expect(tickets[0]!.marcado).toContain(`[QR] ${textoDelQr(comprobante())}`);
    expect(tickets[0]!.comandosDesconocidos).toEqual([]);
  });
});

const reporte: ReporteParaTicket = {
  turno: { caja: { nombre: 'Caja 1' }, responsable: { nombre: 'Carla Díaz' } },
  fondo: '200.00',
  ventas: {
    total: '310.14',
    cantidad: 5,
    porTipo: [{ tipo: 'BOLETA', cantidad: 5, total: '310.14' }],
    porMedio: [
      { medio: 'EFECTIVO', cantidad: 2, monto: '102.50' },
      { medio: 'TARJETA_CREDITO', cantidad: 1, monto: '69.20' },
      { medio: 'TARJETA_DEBITO', cantidad: 1, monto: '40.00' },
      { medio: 'YAPE', cantidad: 1, monto: '29.20' },
      { medio: 'PLIN', cantidad: 1, monto: '69.20' },
    ],
    descuentos: '0.00',
    cortesias: '0.00',
    igv: '44.84',
    icbper: '4.00',
    redondeos: '0.04',
    vueltos: '47.50',
  },
  movimientos: {
    ingresos: '20.00',
    egresos: '15.50',
    lista: [
      { tipo: 'INGRESO', monto: '20.00', motivo: 'Cambio de billetes' },
      { tipo: 'EGRESO', monto: '15.50', motivo: 'Compra de hielo' },
    ],
  },
  esperado: [
    { medio: 'EFECTIVO', monto: '307.00' },
    { medio: 'TARJETA_CREDITO', monto: '69.20' },
    { medio: 'TARJETA_DEBITO', monto: '40.00' },
    { medio: 'YAPE', monto: '29.20' },
    { medio: 'PLIN', monto: '69.20' },
  ],
};

const reporteZ: ReporteParaTicket = {
  ...reporte,
  cierre: {
    cerradoPor: { nombre: 'Sara Vega' },
    conteo: [
      {
        medio: 'EFECTIVO',
        esperado: '307.00',
        contado: '305.00',
        diferencia: '-2.00',
        motivo: 'Vuelto mal dado',
      },
      {
        medio: 'TARJETA_CREDITO',
        esperado: '69.20',
        contado: '69.20',
        diferencia: '0.00',
        motivo: null,
      },
      {
        medio: 'TARJETA_DEBITO',
        esperado: '40.00',
        contado: '40.00',
        diferencia: '0.00',
        motivo: null,
      },
      { medio: 'YAPE', esperado: '29.20', contado: '30.00', diferencia: '0.80', motivo: 'Propina' },
      { medio: 'PLIN', esperado: '69.20', contado: '69.20', diferencia: '0.00', motivo: null },
    ],
  },
};

const ctxReporte = {
  sucursal: 'Miraflores',
  abierto: '02/11 10:00',
  cerrado: '02/11 22:05',
  generado: '02/11 22:05',
};

describe('criterio 95 · el X y la Z impresos', () => {
  it.each(ANCHOS)(
    'el X lleva el turno, las ventas, los movimientos y el esperado en %i mm',
    (ancho) => {
      const ticket = imprimir(
        documentoDeReporteCaja('REPORTE_X', reporte, ctxReporte),
        ancho,
        'PC850',
      );
      for (const esperado of [
        'REPORTE X',
        'Caja: Caja 1',
        'Cajero: Carla Díaz',
        'Abierto: 02/11 10:00',
        'Fondo inicial',
        '200.00',
        'Comprobantes (5)',
        '310.14',
        'Boletas (5)',
        'Efectivo (2)',
        '102.50',
        'Tarjeta de crédito (1)',
        'IGV',
        '44.84',
        'ICBPER',
        'Redondeos',
        'Vueltos',
        '47.50',
        'Ingresos',
        'Egresos',
        'Cambio de billetes',
        'Compra de hielo',
        'ESPERADO EN CAJA',
        '307.00',
        'el turno sigue abierto',
      ]) {
        expect(sinEspacios(ticket.texto), esperado).toContain(sinEspacios(esperado));
      }
      expect(ticket.texto).not.toContain('CONTEO DEL CIERRE');
    },
  );

  it.each(ANCHOS)(
    'la Z agrega quién cerró y el conteo con diferencias y motivos en %i mm',
    (ancho) => {
      const ticket = imprimir(
        documentoDeReporteCaja('REPORTE_Z', reporteZ, ctxReporte),
        ancho,
        'SIN_TILDES',
      );
      for (const esperado of [
        'REPORTE Z',
        'Cerrado: 02/11 22:05',
        'Cerro: Sara Vega',
        'CONTEO DEL CIERRE',
        'Contado',
        '305.00',
        'Diferencia',
        '-2.00',
        '+0.80',
        'Motivo: Vuelto mal dado',
        'Motivo: Propina',
        'definitivo',
      ]) {
        expect(sinEspacios(ticket.texto), esperado).toContain(sinEspacios(esperado));
      }
    },
  );

  it('con cientos de movimientos omite la lista pero deja los totales', () => {
    const lista = Array.from({ length: 4000 }, (_, i) => ({
      tipo: 'INGRESO' as const,
      monto: '1.00',
      motivo: `Movimiento ${i}`,
    }));
    const doc = documentoDeReporteCaja(
      'REPORTE_X',
      { ...reporte, movimientos: { ingresos: '4000.00', egresos: '0.00', lista } },
      ctxReporte,
    );
    expect(doc.bloques.length).toBeLessThan(3000);
    const ticket = imprimir(doc, 80, 'PC850');
    expect(sinEspacios(ticket.texto)).toContain('Ingresos4,000.00');
  });
});

/** Quita los espacios: el ancho del papel reparte los textos en columnas distintas. */
function sinEspacios(texto: string): string {
  return texto.replace(/\s+/g, '');
}
