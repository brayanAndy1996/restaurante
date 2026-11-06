// spec: 006-caja-cobro (criterio 162 y 157; prueba del desarrollador, T43)
//
// El ticket definitivo de 6b: la leyenda «Representación impresa de la …» con o sin la dirección de consulta, la marca de
// simulado en doble alto al inicio y al final (en 58 y 80 mm), el QR sin el hash, y la nota de crédito con el documento que
// modifica, el motivo y la devolución por medio.
import { montoEnLetras } from '@restaurante/dominio';
import { describe, expect, it } from 'vitest';
import {
  documentoDeComprobante,
  textoDelQr,
  type ComprobanteParaTicket,
  type ContextoDeComprobante,
} from '../../../src/modulos/impresion/escpos';
import { ANCHOS, columnasDe, imprimir, textos } from './ayudas-escpos';

const MARCA = 'SIMULADO · SIN VALOR TRIBUTARIO';
const sinEspacios = (texto: string): string => texto.replace(/\s+/g, '');

function comprobante(extra: Partial<ComprobanteParaTicket> = {}): ComprobanteParaTicket {
  return {
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 124,
    numero: 'B001-00000124',
    fechaEmision: '2026-11-02',
    emisor: { ruc: '20123456789', razonSocial: 'Cevichería El Muelle S.A.C.' },
    sucursal: { nombre: 'Miraflores', direccion: 'Av. Larco 123, Miraflores' },
    cliente: null,
    tasaIgv: '18.00',
    lineas: [
      {
        cantidad: 2,
        descripcion: 'Lomo saltado',
        bruto: '56.00',
        descuento: '0.00',
        gratuita: false,
      },
    ],
    totales: {
      descuentos: '0.00',
      operaciones: { gravadas: '47.46', exoneradas: '0.00', inafectas: '0.00', gratuitas: '0.00' },
      igv: '8.54',
      icbper: '0.00',
      total: '56.00',
    },
    montoEnLetras: montoEnLetras('56.00'),
    orden: null,
    ...extra,
  };
}

const contexto = (extra: Partial<ContextoDeComprobante> = {}): ContextoDeComprobante => ({
  hora: '20:15',
  pagos: [{ medio: 'EFECTIVO', monto: '56.00', recibido: '60.00' }],
  vuelto: '4.00',
  redondeo: '0.00',
  abreGaveta: false,
  ...extra,
});

describe('criterio 162 · la leyenda del ticket definitivo', () => {
  it.each(ANCHOS)(
    'dice «Representación impresa de la …» y ya no «pendiente de envío» en %i mm',
    (ancho) => {
      for (const [tipo, titulo] of [
        ['BOLETA', 'BOLETA DE VENTA ELECTRÓNICA'],
        ['FACTURA', 'FACTURA ELECTRÓNICA'],
        ['NOTA_CREDITO_BOLETA', 'NOTA DE CRÉDITO ELECTRÓNICA'],
      ] as const) {
        const t = imprimir(
          documentoDeComprobante(comprobante({ tipo }), contexto()),
          ancho,
          'PC850',
        ).texto;
        expect(sinEspacios(t), tipo).toContain(
          sinEspacios(`Representación impresa de la ${titulo}`),
        );
        expect(t).not.toContain('pendiente de envío');
      }
    },
  );

  it('con la dirección de consulta del conector la imprime; sin ella, o con null, no dice «Consulte»', () => {
    const con = imprimir(
      documentoDeComprobante(
        comprobante(),
        contexto({ urlConsulta: 'https://consulta.example.pe/comprobantes' }),
      ),
      80,
      'PC850',
    ).texto;
    expect(sinEspacios(con)).toContain(
      sinEspacios('Consulte su comprobante en https://consulta.example.pe/comprobantes'),
    );
    for (const extra of [{}, { urlConsulta: null }, { urlConsulta: '   ' }]) {
      const sin = imprimir(
        documentoDeComprobante(comprobante(), contexto(extra)),
        80,
        'PC850',
      ).texto;
      expect(sin).not.toContain('Consulte');
    }
  });

  it('una dirección de consulta larga se reparte en líneas sin perder nada ni pasar del ancho', () => {
    const url = `https://consulta.example.pe/${'ruta-larga/'.repeat(12)}fin`;
    const ticket = imprimir(
      documentoDeComprobante(comprobante(), contexto({ urlConsulta: url })),
      58,
      'PC850',
    );
    expect(sinEspacios(ticket.texto)).toContain(sinEspacios(url));
    for (const l of textos(ticket)) expect(l.length).toBeLessThanOrEqual(columnasDe(58));
  });

  it.each(ANCHOS)(
    'un comprobante simulado lleva la marca en doble alto al inicio y al final en %i mm',
    (ancho) => {
      const ticket = imprimir(
        documentoDeComprobante(comprobante({ simulado: true }), contexto()),
        ancho,
        'PC850',
      );
      const marcas = ticket.lineas.filter((l) => l.texto.includes(MARCA));
      expect(marcas).toHaveLength(2);
      for (const m of marcas) expect(m.dobleAlto).toBe(true);
      const todas = ticket.lineas.map((l) => l.texto);
      // La primera línea impresa es la marca (antes de la razón social) y la última, la marca otra vez.
      expect(todas.findIndex((l) => l.includes(MARCA))).toBeLessThan(
        todas.findIndex((l) => l.includes('Cevichería')),
      );
      expect(todas.findLastIndex((l) => l.includes(MARCA))).toBeGreaterThan(
        todas.findIndex((l) => l.includes('Representación impresa')),
      );
      for (const l of textos(ticket)) expect(l.length).toBeLessThanOrEqual(columnasDe(ancho));
    },
  );

  it('uno que no es simulado no lleva la marca; el pulso de la gaveta sigue siendo lo primero', () => {
    const real = imprimir(
      documentoDeComprobante(comprobante({ simulado: false }), contexto()),
      80,
      'PC850',
    );
    expect(real.texto).not.toContain('SIMULADO');
    const doc = documentoDeComprobante(
      comprobante({ simulado: true }),
      contexto({ abreGaveta: true }),
    );
    expect(doc.bloques[0]).toEqual({ tipo: 'gaveta' });
    expect(doc.bloques[1]).toEqual({ tipo: 'titulo', texto: MARCA });
    expect(doc.bloques.at(-1)).toEqual({ tipo: 'titulo', texto: MARCA });
  });

  it('el QR lleva los datos que se conocen al emitir y nunca el hash, sea o no simulado', () => {
    const esperado = '20123456789|03|B001|00000124|8.54|56.00|2026-11-02|0|-|';
    for (const simulado of [true, false]) {
      const ticket = imprimir(
        documentoDeComprobante(comprobante({ simulado }), contexto()),
        80,
        'PC850',
      );
      expect(ticket.qrs).toEqual([esperado]);
    }
    // El PDF, que se arma al aceptarse, sí agrega el hash al final.
    expect(textoDelQr(comprobante(), 'k3J9xQe1Zr0hash=')).toBe(
      '20123456789|03|B001|00000124|8.54|56.00|2026-11-02|0|-|k3J9xQe1Zr0hash=|',
    );
  });
});

describe('criterio 157 · el ticket de una nota de crédito con su devolución', () => {
  const nota = (extra: Partial<ComprobanteParaTicket> = {}) =>
    comprobante({
      tipo: 'NOTA_CREDITO_BOLETA',
      serie: 'BC01',
      numero: 'BC01-00000003',
      correlativo: 3,
      afectaA: { tipo: 'BOLETA', numero: 'B001-00000124' },
      nota: { tipo: 'DEVOLUCION', motivo: 'El cliente devolvió un plato' },
      ...extra,
    });

  it('lleva el documento que modifica, el motivo y la devolución por medio con el redondeo', () => {
    const ticket = imprimir(
      documentoDeComprobante(
        nota(),
        contexto({
          pagos: [],
          vuelto: '0.00',
          devolucion: {
            pagos: [
              { medio: 'EFECTIVO', monto: '27.90' },
              { medio: 'YAPE', monto: '10.00' },
            ],
            redondeo: '0.10',
          },
        }),
      ),
      80,
      'PC850',
    );
    const t = sinEspacios(ticket.texto);
    for (const esperado of [
      'NOTA DE CRÉDITO ELECTRÓNICA',
      'BC01-00000003',
      'Modifica: BOLETA B001-00000124',
      'Motivo: El cliente devolvió un plato',
      'DEVOLUCIÓN',
      'Efectivo27.90',
      'Yape10.00',
      'Redondeo-0.10',
      'Representación impresa de la NOTA DE CRÉDITO ELECTRÓNICA',
    ]) {
      expect(t, esperado).toContain(sinEspacios(esperado));
    }
    // Una nota no lleva pagos ni vuelto de cobro.
    expect(ticket.texto).not.toContain('Recibido');
    expect(ticket.texto).not.toContain('Vuelto');
  });

  it('sin devolución (anulación sin dinero) no lleva la sección', () => {
    const t = imprimir(
      documentoDeComprobante(
        nota({ nota: { tipo: 'ANULACION', motivo: 'Error de digitación' } }),
        contexto({ pagos: [], vuelto: '0.00', devolucion: null }),
      ),
      80,
      'PC850',
    ).texto;
    expect(t).not.toContain('DEVOLUCIÓN');
    expect(t).toContain('Motivo: Error de digitación');
  });
});
