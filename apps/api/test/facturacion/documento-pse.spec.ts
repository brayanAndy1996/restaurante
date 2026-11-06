import type { ComprobanteRespuesta } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { armarDocumentoPse, type ResultadoPse } from '../../src/modulos/facturacion/pse';
import {
  guardarArchivosDeComprobante,
  recortar,
} from '../../src/modulos/facturacion/envios/resultado-pse';
import { AlmacenComprobantesEnMemoria } from '../../src/nucleo/archivos';

// Pruebas del desarrollador (no protegidas) de `armarDocumentoPse` y de los recortes del criterio 131 (historia 006).

const ID = '33333333-3333-3333-3333-333333333333';
type ResultadoAceptado = Extract<ResultadoPse, { tipo: 'ACEPTADO' }>;

function boleta(cambios: Partial<ComprobanteRespuesta> = {}): ComprobanteRespuesta {
  return {
    id: ID,
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 124,
    numero: 'B001-00000124',
    formato: 'DETALLADO',
    estado: 'POR_ENVIAR',
    fechaEmision: '2026-11-06',
    emitidoEn: '2026-11-06T15:00:00.000Z',
    diaOperativo: '2026-11-06',
    emisor: { ruc: '20100070970', razonSocial: 'Restaurante SAC', regimen: 'GENERAL' },
    sucursal: { nombre: 'Centro', direccion: 'Av. Lima 1', codigoEstablecimiento: '0000' },
    cajaId: ID,
    turnoId: ID,
    turnoResponsableId: ID,
    cobroId: ID,
    numeroParte: 1,
    cliente: { tipoDocumento: 'DNI', numero: '12345678', nombre: 'Ana Pérez', direccion: null },
    moneda: 'PEN',
    tasaIgv: '18.00',
    lineas: [
      {
        posicion: 1,
        itemId: null,
        descripcion: 'Lomo saltado',
        cantidad: 1,
        unidad: 'NIU',
        precioUnitario: '28.00',
        valorUnitario: '23.7288135593',
        bruto: '28.00',
        descuento: '0.00',
        neto: '28.00',
        base: '23.73',
        igv: '4.27',
        bolsas: 0,
        icbper: '0.00',
        afectacion: 'GRAVADO',
        gratuita: false,
        valorReferencial: null,
        baseReferencial: null,
        igvReferencial: null,
        posicionOrigen: null,
      },
      {
        posicion: 2,
        itemId: null,
        descripcion: 'Mandarina',
        cantidad: 1,
        unidad: 'NIU',
        precioUnitario: '0.00',
        valorUnitario: '0.0000000000',
        bruto: '0.00',
        descuento: '0.00',
        neto: '0.00',
        base: '0.00',
        igv: '0.00',
        bolsas: 0,
        icbper: '0.00',
        afectacion: 'EXONERADO',
        gratuita: true,
        valorReferencial: '3.00',
        baseReferencial: '3.00',
        igvReferencial: '0.00',
      },
    ],
    totales: {
      subtotal: '28.00',
      descuentos: '0.00',
      operaciones: { gravadas: '23.73', exoneradas: '0.00', inafectas: '0.00', gratuitas: '3.00' },
      igv: '4.27',
      igvGratuitas: '0.00',
      icbper: '0.00',
      total: '28.00',
    },
    montoEnLetras: 'VEINTIOCHO CON 00/100 SOLES',
    orden: null,
    ...cambios,
  };
}

describe('armarDocumentoPse', () => {
  it('arma el identificador, el emisor, el cliente y las líneas con los códigos de SUNAT', () => {
    const documento = armarDocumentoPse(boleta());
    expect(documento.id).toEqual({
      rucEmisor: '20100070970',
      tipoSunat: '03',
      serie: 'B001',
      numero: 124,
    });
    expect(documento.emisor).toEqual({
      ruc: '20100070970',
      razonSocial: 'Restaurante SAC',
      codigoEstablecimiento: '0000',
      direccion: 'Av. Lima 1',
    });
    expect(documento.cliente).toEqual({
      tipoDocumentoSunat: '1',
      numero: '12345678',
      nombre: 'Ana Pérez',
      direccion: null,
    });
    expect(documento.lineas.map((l) => l.afectacionSunat)).toEqual(['10', '21']);
    expect(documento.totales).toMatchObject({
      gravadas: '23.73',
      gratuitas: '3.00',
      total: '28.00',
    });
    expect(documento.nota).toBeNull();
  });

  it('es determinista: el mismo comprobante da el mismo documento, byte a byte', () => {
    expect(JSON.stringify(armarDocumentoPse(boleta()))).toBe(
      JSON.stringify(armarDocumentoPse(boleta())),
    );
  });

  it('una boleta sin cliente deja el cliente en null; Nuevo RUS deja las operaciones en null', () => {
    const documento = armarDocumentoPse(
      boleta({
        cliente: null,
        tasaIgv: null,
        totales: { ...boleta().totales, operaciones: null },
      }),
    );
    expect(documento.cliente).toBeNull();
    expect(documento.tasaIgv).toBeNull();
    expect(documento.totales.gravadas).toBeNull();
  });

  it('una nota de crédito lleva el tipo de nota, el motivo y el documento que modifica', () => {
    const documento = armarDocumentoPse(
      boleta({
        tipo: 'NOTA_CREDITO_BOLETA',
        serie: 'BN01',
        correlativo: 7,
        numero: 'BN01-00000007',
        afectaA: { id: ID, tipo: 'FACTURA', numero: 'F001-00000010' },
        nota: { tipo: 'DEVOLUCION', motivo: 'Devolución de un plato', cambioAFactura: false },
      }),
    );
    expect(documento.id.tipoSunat).toBe('07');
    expect(documento.nota).toEqual({
      tipoNotaSunat: '07',
      motivo: 'Devolución de un plato',
      documentoReferencia: {
        rucEmisor: '20100070970',
        tipoSunat: '01',
        serie: 'F001',
        numero: 10,
      },
    });
  });
});

describe('recortar', () => {
  it('recorta por caracteres, quita los NUL y deja nulo lo vacío', () => {
    expect(recortar('abcdef', 3)).toBe('abc');
    expect(recortar('😀😀😀', 2)).toBe('😀😀');
    expect(recortar('a\u0000b', 10)).toBe('ab');
    expect(recortar('', 10)).toBeNull();
    expect(recortar(null, 10)).toBeNull();
  });
});

describe('guardarArchivosDeComprobante', () => {
  const aceptado = (xml: Buffer | null, cdr: Buffer | null): ResultadoAceptado => ({
    tipo: 'ACEPTADO',
    codigoSunat: '0',
    mensaje: 'ok',
    observaciones: [],
    hash: null,
    xml,
    cdr,
    referenciaPse: null,
  });

  it('guarda el XML y un CDR zip bajo comprobantes/<empresa>/<comprobante>/', async () => {
    const almacen = new AlmacenComprobantesEnMemoria();
    const claves = await guardarArchivosDeComprobante(
      almacen,
      'E',
      ID,
      aceptado(Buffer.from('<xml/>'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 1])),
    );
    expect(claves).toEqual({
      xmlClave: `comprobantes/E/${ID}/documento.xml`,
      cdrClave: `comprobantes/E/${ID}/cdr.zip`,
    });
    expect(almacen.obtener(claves.cdrClave!)?.tipo).toBe('application/zip');
  });

  it('un CDR que no es zip se guarda como .xml y sin archivos no guarda nada', async () => {
    const almacen = new AlmacenComprobantesEnMemoria();
    const claves = await guardarArchivosDeComprobante(
      almacen,
      'E',
      ID,
      aceptado(null, Buffer.from('<cdr/>')),
    );
    expect(claves).toEqual({ xmlClave: null, cdrClave: `comprobantes/E/${ID}/cdr.xml` });
    const vacio = new AlmacenComprobantesEnMemoria();
    expect(await guardarArchivosDeComprobante(vacio, 'E', ID, aceptado(null, null))).toEqual({
      xmlClave: null,
      cdrClave: null,
    });
    expect(vacio.claves()).toEqual([]);
  });
});
