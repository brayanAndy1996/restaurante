// spec: 006-caja-cobro (criterio 159 y 162; PDF propio del comprobante, prueba del desarrollador)
//
// `PdfComprobantes.armar` con `pdfkit` y `qrcode`: el texto que lleva (extraído del propio PDF), la marca de simulado, la
// leyenda con o sin dirección de consulta, la nota de crédito, la paginación y el QR. Sin base de datos.
import type { ComprobanteRespuesta } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { PdfComprobantes, textoParaPdf } from '../../src/modulos/facturacion/pdf/pdf-comprobantes';
import { imagenesDelPdf, paginasDelPdf, textoDelPdf } from './texto-de-pdf';

const pdf = new PdfComprobantes();

function comprobante(cambios: Partial<ComprobanteRespuesta> = {}): ComprobanteRespuesta {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 124,
    numero: 'B001-00000124',
    formato: 'DETALLADO',
    estado: 'ACEPTADO',
    fechaEmision: '2026-11-02',
    emitidoEn: '2026-11-02T20:15:00-05:00',
    diaOperativo: '2026-11-02',
    emisor: { ruc: '20123456789', razonSocial: 'Cevichería El Muelle S.A.C.', regimen: 'GENERAL' },
    sucursal: {
      nombre: 'Miraflores',
      direccion: 'Av. Larco 123, Miraflores',
      codigoEstablecimiento: '0000',
    },
    cajaId: '22222222-2222-4222-8222-222222222222',
    turnoId: '33333333-3333-4333-8333-333333333333',
    turnoResponsableId: '44444444-4444-4444-8444-444444444444',
    cobroId: '55555555-5555-4555-8555-555555555555',
    numeroParte: null,
    cliente: null,
    moneda: 'PEN',
    tasaIgv: '18.00',
    lineas: [
      {
        posicion: 1,
        itemId: null,
        descripcion: 'Lomo saltado',
        cantidad: 2,
        unidad: 'NIU',
        precioUnitario: '28.00',
        valorUnitario: '23.7288135593',
        bruto: '56.00',
        descuento: '5.60',
        neto: '50.40',
        base: '42.71',
        igv: '7.69',
        bolsas: 0,
        icbper: '0.00',
        afectacion: 'GRAVADO',
        gratuita: false,
        valorReferencial: null,
      },
      {
        posicion: 2,
        itemId: null,
        descripcion: 'Chicha morada (cortesía de la casa)',
        cantidad: 1,
        unidad: 'NIU',
        precioUnitario: '8.00',
        valorUnitario: '6.7796610169',
        bruto: '8.00',
        descuento: '0.00',
        neto: '0.00',
        base: '0.00',
        igv: '0.00',
        bolsas: 0,
        icbper: '0.00',
        afectacion: 'GRAVADO',
        gratuita: true,
        valorReferencial: '8.00',
      },
    ],
    totales: {
      subtotal: '56.00',
      descuentos: '5.60',
      operaciones: { gravadas: '42.71', exoneradas: '0.00', inafectas: '0.00', gratuitas: '6.78' },
      igv: '7.69',
      igvGratuitas: '1.22',
      icbper: '0.00',
      total: '50.40',
    },
    montoEnLetras: 'CINCUENTA CON 40/100 SOLES',
    orden: null,
    simulado: false,
    sunat: { codigo: '0', mensaje: 'Aceptado', observaciones: [], hash: 'k3J9xQe1Zr0hash=' },
    ...cambios,
  } as ComprobanteRespuesta;
}

const MARCA = 'SIMULADO · SIN VALOR TRIBUTARIO';
const cuantas = (texto: string, parte: string): number => texto.split(parte).length - 1;

describe('criterio 159 · el contenido del PDF', () => {
  it('es un PDF de una página A4 con el emisor, el tipo, el número, la fecha, las líneas y los totales guardados', async () => {
    const archivo = await pdf.armar(comprobante(), { urlConsulta: null });
    expect(archivo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(archivo.toString('latin1')).toMatch(/\/MediaBox \[\s*0 0 595\.28 841\.89\s*\]/);
    expect(paginasDelPdf(archivo)).toBe(1);
    const t = textoDelPdf(archivo);
    for (const esperado of [
      'Cevichería El Muelle S.A.C.',
      'RUC: 20123456789',
      'Sucursal: Miraflores',
      'Dirección: Av. Larco 123, Miraflores',
      'BOLETA DE VENTA ELECTRÓNICA',
      'B001-00000124',
      'Fecha de emisión:',
      '02/11/2026',
      '20:15',
      'Lomo saltado',
      'UNIDAD',
      '28.00',
      '56.00',
      'Descuento',
      '-5.60',
      'Chicha morada (cortesía de la casa) (cortesía)',
      'Gratuito',
      'Op. gravadas',
      '42.71',
      'Op. exoneradas',
      'Op. inafectas',
      'Op. gratuitas',
      '6.78',
      'IGV (18%)',
      '7.69',
      'ICBPER',
      'TOTAL S/',
      '50.40',
      'SON: CINCUENTA CON 40/100 SOLES',
      'Hash:',
      'k3J9xQe1Zr0hash=',
    ]) {
      expect(t, esperado).toContain(esperado);
    }
    // No lleva pagos ni vuelto (criterio 159).
    for (const noDebe of ['Vuelto', 'Efectivo', 'Recibido', 'Yape', 'Pagos']) {
      expect(t, noDebe).not.toContain(noDebe);
    }
  });

  it('un cliente con RUC y dirección sale con su nombre, su documento y su dirección; sin cliente dice CLIENTES VARIOS', async () => {
    const sin = textoDelPdf(await pdf.armar(comprobante(), { urlConsulta: null }));
    expect(sin).toContain('CLIENTES VARIOS');
    const con = textoDelPdf(
      await pdf.armar(
        comprobante({
          tipo: 'FACTURA',
          serie: 'F001',
          numero: 'F001-00000007',
          cliente: {
            tipoDocumento: 'RUC',
            numero: '20555555551',
            nombre: 'Distribuidora Ñandú S.R.L.',
            direccion: 'Jr. Unión 456, Lima',
          },
        }),
        { urlConsulta: null },
      ),
    );
    for (const esperado of [
      'FACTURA ELECTRÓNICA',
      'F001-00000007',
      'Distribuidora Ñandú S.R.L.',
      '20555555551',
      'Jr. Unión 456, Lima',
      'Representación impresa de la FACTURA ELECTRÓNICA',
    ]) {
      expect(con, esperado).toContain(esperado);
    }
    expect(con).not.toContain('CLIENTES VARIOS');
  });

  it('con un emisor Nuevo RUS no desglosa operaciones ni IGV', async () => {
    const t = textoDelPdf(
      await pdf.armar(
        comprobante({
          tasaIgv: null,
          totales: { ...comprobante().totales, operaciones: null, igv: '0.00' },
        }),
        { urlConsulta: null },
      ),
    );
    expect(t).toContain('TOTAL S/');
    expect(t).not.toContain('Op. gravadas');
    expect(t).not.toContain('IGV');
  });

  it('una nota de crédito dice qué documento modifica, su tipo y su motivo', async () => {
    const t = textoDelPdf(
      await pdf.armar(
        comprobante({
          tipo: 'NOTA_CREDITO_BOLETA',
          serie: 'BC01',
          numero: 'BC01-00000003',
          afectaA: {
            id: '66666666-6666-4666-8666-666666666666',
            tipo: 'BOLETA',
            numero: 'B001-00000124',
          },
          nota: {
            tipo: 'DEVOLUCION',
            motivo: 'El cliente devolvió un plato',
            cambioAFactura: false,
          },
        }),
        { urlConsulta: null },
      ),
    );
    for (const esperado of [
      'NOTA DE CRÉDITO ELECTRÓNICA',
      'BC01-00000003',
      'Documento que modifica:',
      'BOLETA B001-00000124',
      'Tipo de nota:',
      'Devolución',
      'Motivo:',
      'El cliente devolvió un plato',
      'Representación impresa de la NOTA DE CRÉDITO ELECTRÓNICA',
    ]) {
      expect(t, esperado).toContain(esperado);
    }
  });
});

describe('criterio 162 · la leyenda, la marca de simulado y el QR del PDF', () => {
  it('con una dirección de consulta la imprime; sin ella no dice «Consulte»', async () => {
    const con = textoDelPdf(
      await pdf.armar(comprobante(), { urlConsulta: 'https://consulta.example.pe/ver' }),
    );
    expect(con).toContain('Consulte su comprobante en https://consulta.example.pe/ver');
    const sin = textoDelPdf(await pdf.armar(comprobante(), { urlConsulta: null }));
    expect(sin).not.toContain('Consulte');
    expect(sin).toContain('Representación impresa de la BOLETA DE VENTA ELECTRÓNICA');
  });

  it('un comprobante simulado lleva la marca al inicio y al final; uno real no la lleva', async () => {
    const simulado = textoDelPdf(
      await pdf.armar(comprobante({ simulado: true }), { urlConsulta: null }),
    );
    expect(cuantas(simulado, MARCA)).toBe(2);
    const lineas = simulado.split('\n');
    expect(lineas[0]).toBe(MARCA);
    expect(lineas.at(-1)).toBe(MARCA);
    const real = textoDelPdf(
      await pdf.armar(comprobante({ simulado: false }), { urlConsulta: null }),
    );
    expect(real).not.toContain('SIMULADO');
    expect(real).not.toContain('SIN VALOR TRIBUTARIO');
  });

  it('lleva el QR como una imagen, con o sin hash', async () => {
    // El PNG del QR lleva una máscara de transparencia que `pdfkit` guarda como segunda imagen.
    expect(
      imagenesDelPdf(await pdf.armar(comprobante(), { urlConsulta: null })),
    ).toBeGreaterThanOrEqual(1);
    const sinHash = await pdf.armar(comprobante({ sunat: null }), { urlConsulta: null });
    expect(imagenesDelPdf(sinHash)).toBeGreaterThanOrEqual(1);
    expect(textoDelPdf(sinHash)).not.toContain('Hash:');
  });
});

describe('criterio 159 · robustez', () => {
  it('un comprobante con 150 líneas pasa a más páginas, repite el encabezado de la tabla y no pierde líneas ni totales', async () => {
    const base = comprobante().lineas[0]!;
    const lineas = Array.from({ length: 150 }, (_, i) => ({
      ...base,
      posicion: i + 1,
      descripcion: `Plato número ${i + 1} con un nombre largo para que ocupe más de una línea en la columna`,
    }));
    const archivo = await pdf.armar(comprobante({ lineas, simulado: true }), { urlConsulta: null });
    expect(paginasDelPdf(archivo)).toBeGreaterThan(2);
    const t = textoDelPdf(archivo);
    expect(t).toContain('Plato número 1 ');
    expect(t).toContain('Plato número 150 ');
    expect(cuantas(t, 'Cant.')).toBeGreaterThanOrEqual(2);
    expect(cuantas(t, 'TOTAL S/')).toBe(1);
    expect(cuantas(t, 'SON: CINCUENTA')).toBe(1);
    expect(cuantas(t, MARCA)).toBe(2);
  });

  it('un texto con caracteres que la fuente no dibuja (un emoji) sale con «?» y no rompe el PDF', async () => {
    expect(textoParaPdf('Ají 🌶️ de gallina\n— especial')).toBe('Ají ?? de gallina — especial');
    const t = textoDelPdf(
      await pdf.armar(
        comprobante({ lineas: [{ ...comprobante().lineas[0]!, descripcion: 'Ají 🌶️ picante' }] }),
        { urlConsulta: null },
      ),
    );
    expect(t).toContain('Ají ?? picante');
  });

  it('con el mismo comprobante da los mismos bytes (repetir el trabajo no cambia el archivo)', async () => {
    const a = await pdf.armar(comprobante(), { urlConsulta: null });
    const b = await pdf.armar(comprobante(), { urlConsulta: null });
    expect(b.equals(a)).toBe(true);
  });
});
