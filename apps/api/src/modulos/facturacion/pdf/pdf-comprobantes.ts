import { Injectable } from '@nestjs/common';
import type { ComprobanteLineaRespuesta, ComprobanteRespuesta } from '@restaurante/contratos';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { horaLocal } from '../../../nucleo/reloj';
import { textoDelQr } from '../../impresion';

/**
 * La representación impresa en PDF de un comprobante aceptado (historia 006, entrega 6b, criterio 159): A4 vertical,
 * armada con `pdfkit` y `qrcode` dentro del proceso, sin servicios externos. El worker la arma al aceptarse el comprobante
 * y la guarda en el almacén privado; si falla, el barrido la reintenta.
 *
 * Todo sale de lo guardado en el comprobante (montos, líneas, totales y el texto de «SON: …»): aquí solo se les da formato,
 * no se calcula nada. No lleva pagos ni vuelto. Las fuentes son las estándar (Helvetica, WinAnsi), que cubren las tildes;
 * un carácter fuera de ese juego (un emoji en el nombre de un plato) se imprime como `?`.
 */

const MARGEN = 40;
const ANCHO_A4 = 595.28;
const ALTO_A4 = 841.89;
const ANCHO_UTIL = ANCHO_A4 - 2 * MARGEN;
const BORDE_INFERIOR = ALTO_A4 - MARGEN;
const GRIS = '#555555';
const ROJO = '#b00020';

const TITULO_DEL_TIPO = {
  BOLETA: 'BOLETA DE VENTA ELECTRÓNICA',
  FACTURA: 'FACTURA ELECTRÓNICA',
  NOTA_CREDITO_BOLETA: 'NOTA DE CRÉDITO ELECTRÓNICA',
  NOTA_CREDITO_FACTURA: 'NOTA DE CRÉDITO ELECTRÓNICA',
} as const;

const NOMBRE_DEL_TIPO_MODIFICADO = {
  BOLETA: 'BOLETA',
  FACTURA: 'FACTURA',
  NOTA_CREDITO_BOLETA: 'NOTA DE CRÉDITO',
  NOTA_CREDITO_FACTURA: 'NOTA DE CRÉDITO',
} as const;

const NOMBRE_DEL_DOCUMENTO = { DNI: 'DNI', CE: 'CE', PASAPORTE: 'Pasaporte', RUC: 'RUC' } as const;
const NOMBRE_DE_LA_NOTA = {
  ANULACION: 'Anulación de la operación',
  DEVOLUCION: 'Devolución',
} as const;
const UNIDAD = { NIU: 'UNIDAD', ZZ: 'SERVICIO' } as const;

/** Los caracteres de la página de códigos 1252 fuera de Latin-1 que la fuente estándar sí dibuja. */
const WIN_ANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'));

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g;

/** Un texto que la fuente estándar puede dibujar: una línea, sin controles y con `?` donde no hay carácter. */
export function textoParaPdf(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  return Array.from(valor.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim())
    .map((c) => {
      const codigo = c.codePointAt(0)!;
      return (codigo >= 0x20 && codigo <= 0x7e) ||
        (codigo >= 0xa0 && codigo <= 0xff) ||
        WIN_ANSI_EXTRA.has(c)
        ? c
        : '?';
    })
    .join('');
}

const MONTO = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Un monto guardado ("1234.5") con miles y al menos dos decimales ("1,234.50"): solo formato, sin cuentas. */
function formatoMonto(monto: string): string {
  const partes = MONTO.exec(monto.trim());
  if (partes === null) return textoParaPdf(monto);
  const [, signo, entero, decimales] = partes;
  return `${signo}${entero!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(decimales ?? '').padEnd(2, '0')}`;
}

const esCero = (monto: string): boolean => /^-?0+(?:\.0*)?$/.test(monto.trim());

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return anio === undefined || mes === undefined || dia === undefined
    ? fecha
    : `${dia}/${mes}/${anio}`;
}

@Injectable()
export class PdfComprobantes {
  /**
   * El PDF del comprobante. `urlConsulta` es la del conector del emisor (`null` si no tiene). Si el comprobante es
   * simulado lleva «SIMULADO · SIN VALOR TRIBUTARIO» al inicio y al final. Con el mismo comprobante da los mismos bytes
   * (la fecha de creación es la de emisión), así que repetir el trabajo no cambia el archivo.
   */
  async armar(
    comprobante: ComprobanteRespuesta,
    opciones: { urlConsulta: string | null },
  ): Promise<Buffer> {
    const hash = comprobante.sunat?.hash ?? null;
    const qr = await QRCode.toBuffer(textoDelQr(comprobante, hash), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 300,
      type: 'png',
    });
    const titulo = TITULO_DEL_TIPO[comprobante.tipo];
    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGEN,
      info: {
        Title: textoParaPdf(`${titulo} ${comprobante.numero}`),
        Author: textoParaPdf(comprobante.emisor.razonSocial),
        Creator: 'Software para restaurantes',
        CreationDate: new Date(comprobante.emitidoEn),
        ModDate: new Date(comprobante.emitidoEn),
      },
    });
    const trozos: Buffer[] = [];
    const terminado = new Promise<Buffer>((resolver, rechazar) => {
      doc.on('data', (trozo: Buffer) => trozos.push(trozo));
      doc.on('end', () => resolver(Buffer.concat(trozos)));
      doc.on('error', rechazar);
    });
    dibujar(doc, comprobante, qr, opciones.urlConsulta);
    doc.end();
    return terminado;
  }
}

// ----------------------------------------------------------------------------------------------
// Dibujo
// ----------------------------------------------------------------------------------------------

type Documento = InstanceType<typeof PDFDocument>;

const COLUMNAS = {
  cantidad: { x: MARGEN, ancho: 38 },
  unidad: { x: MARGEN + 46, ancho: 58 },
  descripcion: { x: MARGEN + 112, ancho: 207 },
  precio: { x: MARGEN + 327, ancho: 70 },
  importe: { x: MARGEN + 405, ancho: ANCHO_UTIL - 405 },
} as const;

function dibujar(
  doc: Documento,
  c: ComprobanteRespuesta,
  qr: Buffer,
  urlConsulta: string | null,
): void {
  let y = MARGEN;
  const simulado = c.simulado === true;
  const marcaSimulado = (): void => {
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(ROJO)
      .text('SIMULADO · SIN VALOR TRIBUTARIO', MARGEN, y, { width: ANCHO_UTIL, align: 'center' });
    doc.fillColor('black');
  };
  if (simulado) {
    marcaSimulado();
    y += 26;
  }

  // Encabezado: el emisor a la izquierda y el recuadro del documento a la derecha.
  const anchoIzquierda = ANCHO_UTIL - 215;
  doc.font('Helvetica-Bold').fontSize(14).fillColor('black');
  const razonSocial = textoParaPdf(c.emisor.razonSocial);
  doc.text(razonSocial, MARGEN, y, { width: anchoIzquierda });
  let yIzquierda = doc.y + 4;
  doc.font('Helvetica').fontSize(9);
  for (const texto of [
    `Sucursal: ${textoParaPdf(c.sucursal.nombre)}`,
    `Dirección: ${textoParaPdf(c.sucursal.direccion)}`,
  ]) {
    doc.text(texto, MARGEN, yIzquierda, { width: anchoIzquierda });
    yIzquierda = doc.y + 2;
  }

  const xCaja = MARGEN + ANCHO_UTIL - 205;
  doc.font('Helvetica-Bold').fontSize(11);
  const titulo = TITULO_DEL_TIPO[c.tipo];
  const altoCaja = 78;
  doc.rect(xCaja, y, 205, altoCaja).lineWidth(1).stroke('black');
  doc.text(`RUC: ${textoParaPdf(c.emisor.ruc)}`, xCaja + 6, y + 10, {
    width: 193,
    align: 'center',
  });
  doc.text(titulo, xCaja + 6, y + 30, { width: 193, align: 'center' });
  doc.fontSize(12).text(textoParaPdf(c.numero), xCaja + 6, y + 56, { width: 193, align: 'center' });

  y = Math.max(yIzquierda, y + altoCaja) + 14;

  // Datos del documento: fecha y hora, cliente y, en una nota de crédito, el documento que modifica y el motivo.
  const datos: Array<[string, string]> = [
    ['Fecha de emisión', fechaCorta(c.fechaEmision)],
    ['Hora', horaLocal(new Date(c.emitidoEn))],
    ['Moneda', 'SOLES (PEN)'],
  ];
  const cliente = c.cliente;
  if (cliente === null) {
    datos.push(['Cliente', 'CLIENTES VARIOS']);
  } else {
    datos.push(
      ['Cliente', textoParaPdf(cliente.nombre)],
      [NOMBRE_DEL_DOCUMENTO[cliente.tipoDocumento], textoParaPdf(cliente.numero)],
    );
    if (cliente.direccion !== null && textoParaPdf(cliente.direccion).length > 0) {
      datos.push(['Dirección', textoParaPdf(cliente.direccion)]);
    }
  }
  if (c.afectaA !== undefined && c.afectaA !== null) {
    datos.push([
      'Documento que modifica',
      `${NOMBRE_DEL_TIPO_MODIFICADO[c.afectaA.tipo]} ${textoParaPdf(c.afectaA.numero)}`,
    ]);
  }
  if (c.nota !== undefined && c.nota !== null) {
    datos.push(
      ['Tipo de nota', NOMBRE_DE_LA_NOTA[c.nota.tipo]],
      ['Motivo', textoParaPdf(c.nota.motivo)],
    );
  }
  for (const [nombre, valor] of datos) {
    y = asegurar(doc, y, 14, () => 0);
    doc.font('Helvetica-Bold').fontSize(9).text(`${nombre}:`, MARGEN, y, {
      width: 120,
      lineBreak: false,
    });
    doc
      .font('Helvetica')
      .fontSize(9)
      .text(valor, MARGEN + 125, y, { width: ANCHO_UTIL - 125 });
    y = doc.y + 3;
  }
  y += 8;

  // Líneas.
  y = encabezadoDeTabla(doc, y);
  for (const linea of c.lineas) {
    const alto = altoDeLinea(doc, linea);
    const nuevo = asegurar(doc, y, alto, (arriba) => encabezadoDeTabla(doc, arriba));
    y = dibujarLinea(doc, linea, nuevo);
  }
  doc
    .moveTo(MARGEN, y + 2)
    .lineTo(MARGEN + ANCHO_UTIL, y + 2)
    .lineWidth(0.5)
    .stroke(GRIS);
  y += 12;

  // Totales (los guardados), a la derecha.
  const filas: Array<[string, string, boolean]> = [];
  const t = c.totales;
  if (!esCero(t.descuentos)) filas.push(['Descuentos', `-${t.descuentos}`, false]);
  if (t.operaciones !== null) {
    filas.push(
      ['Op. gravadas', t.operaciones.gravadas, false],
      ['Op. exoneradas', t.operaciones.exoneradas, false],
      ['Op. inafectas', t.operaciones.inafectas, false],
      ['Op. gratuitas', t.operaciones.gratuitas, false],
      [
        c.tasaIgv === null ? 'IGV' : `IGV (${formatoMonto(c.tasaIgv).replace(/\.00$/, '')}%)`,
        t.igv,
        false,
      ],
    );
  }
  filas.push(['ICBPER', t.icbper, false], ['TOTAL S/', t.total, true]);
  y = asegurar(doc, y, filas.length * 15 + 150, () => 0);
  const xEtiqueta = MARGEN + ANCHO_UTIL - 230;
  for (const [etiqueta, monto, negrita] of filas) {
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrita ? 11 : 9.5);
    doc.text(etiqueta, xEtiqueta, y, { width: 130, lineBreak: false });
    doc.text(formatoMonto(monto), xEtiqueta + 130, y, { width: 100, align: 'right' });
    y += negrita ? 18 : 15;
  }
  y += 4;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(`SON: ${textoParaPdf(c.montoEnLetras)}`, MARGEN, y, {
      width: ANCHO_UTIL,
    });
  y = doc.y + 14;

  // QR, hash y leyenda.
  y = asegurar(doc, y, 110, () => 0);
  doc.image(qr, MARGEN, y, { width: 96, height: 96 });
  const xTexto = MARGEN + 110;
  const anchoTexto = ANCHO_UTIL - 110;
  let yTexto = y + 4;
  const hash = c.sunat?.hash ?? null;
  if (hash !== null) {
    doc.font('Helvetica-Bold').fontSize(8).text('Hash:', xTexto, yTexto, { width: anchoTexto });
    doc.font('Helvetica').fontSize(8).text(textoParaPdf(hash), xTexto, doc.y, {
      width: anchoTexto,
    });
    yTexto = doc.y + 6;
  }
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(`Representación impresa de la ${titulo}`, xTexto, yTexto, { width: anchoTexto });
  yTexto = doc.y + 2;
  if (urlConsulta !== null) {
    doc.text(`Consulte su comprobante en ${textoParaPdf(urlConsulta)}`, xTexto, yTexto, {
      width: anchoTexto,
    });
  }
  y += 106;

  if (simulado) {
    y = asegurar(doc, y, 24, () => 0);
    marcaSimulado();
  }
}

/** Si el bloque no cabe en la página, abre otra y devuelve la `y` donde seguir (tras repetir lo que `alAbrir` dibuje). */
function asegurar(doc: Documento, y: number, alto: number, alAbrir: (y: number) => number): number {
  if (y + alto <= BORDE_INFERIOR) return y;
  doc.addPage();
  return alAbrir(MARGEN);
}

function encabezadoDeTabla(doc: Documento, y: number): number {
  doc.rect(MARGEN, y, ANCHO_UTIL, 16).fill('#e8e8e8');
  doc.fillColor('black').font('Helvetica-Bold').fontSize(8.5);
  const arriba = y + 4;
  doc.text('Cant.', COLUMNAS.cantidad.x, arriba, {
    width: COLUMNAS.cantidad.ancho,
    align: 'right',
  });
  doc.text('Unidad', COLUMNAS.unidad.x, arriba, { width: COLUMNAS.unidad.ancho });
  doc.text('Descripción', COLUMNAS.descripcion.x, arriba, { width: COLUMNAS.descripcion.ancho });
  doc.text('P. unit.', COLUMNAS.precio.x, arriba, { width: COLUMNAS.precio.ancho, align: 'right' });
  doc.text('Importe', COLUMNAS.importe.x, arriba, {
    width: COLUMNAS.importe.ancho,
    align: 'right',
  });
  return y + 22;
}

function descripcionDe(linea: ComprobanteLineaRespuesta): string {
  return textoParaPdf(linea.descripcion) + (linea.gratuita ? ' (cortesía)' : '');
}

function altoDeLinea(doc: Documento, linea: ComprobanteLineaRespuesta): number {
  doc.font('Helvetica').fontSize(9);
  const alto = Math.max(
    doc.heightOfString(descripcionDe(linea), { width: COLUMNAS.descripcion.ancho }),
    11,
  );
  return alto + 4 + (esCero(linea.descuento) || linea.gratuita ? 0 : 13);
}

function dibujarLinea(doc: Documento, linea: ComprobanteLineaRespuesta, y: number): number {
  doc.font('Helvetica').fontSize(9).fillColor('black');
  const alto = Math.max(
    doc.heightOfString(descripcionDe(linea), { width: COLUMNAS.descripcion.ancho }),
    11,
  );
  doc.text(String(linea.cantidad), COLUMNAS.cantidad.x, y, {
    width: COLUMNAS.cantidad.ancho,
    align: 'right',
  });
  doc.text(UNIDAD[linea.unidad], COLUMNAS.unidad.x, y, { width: COLUMNAS.unidad.ancho });
  doc.text(descripcionDe(linea), COLUMNAS.descripcion.x, y, { width: COLUMNAS.descripcion.ancho });
  doc.text(formatoMonto(linea.precioUnitario), COLUMNAS.precio.x, y, {
    width: COLUMNAS.precio.ancho,
    align: 'right',
  });
  doc.text(linea.gratuita ? 'Gratuito' : formatoMonto(linea.bruto), COLUMNAS.importe.x, y, {
    width: COLUMNAS.importe.ancho,
    align: 'right',
  });
  let siguiente = y + alto + 4;
  if (!linea.gratuita && !esCero(linea.descuento)) {
    doc.text('Descuento', COLUMNAS.descripcion.x, siguiente - 2, {
      width: COLUMNAS.descripcion.ancho,
    });
    doc.text(`-${formatoMonto(linea.descuento)}`, COLUMNAS.importe.x, siguiente - 2, {
      width: COLUMNAS.importe.ancho,
      align: 'right',
    });
    siguiente += 13;
  }
  return siguiente;
}
