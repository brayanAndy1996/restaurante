import {
  LARGO_TEXTO_QR_TICKET,
  VERSION_DOCUMENTO_TICKET,
  type BloqueTicket,
  type DocumentoTicket,
} from '@restaurante/contratos';
import type { MedioPago, TipoDocumentoElectronico } from '@restaurante/dominio';
import { ETIQUETA_DE_MEDIO, esCero } from './etiquetas-caja';
import { ajustarAlPresupuesto } from './presupuesto';
import { formatoMonto, juntarEnLineas, limpiarTexto, lineasDeMesas } from './texto';

/**
 * Plantilla del ticket del comprobante (historia 006, criterios 90 y 91): razón social y RUC del emisor, sucursal y
 * dirección, el tipo de comprobante con su serie y número, la fecha y la hora, el cliente (si hay), la mesa y el
 * mozo o el número de llamado, las líneas con sus importes, los descuentos y las cortesías, las operaciones, el IGV
 * con su tasa, el ICBPER, el total, "SON: …", los pagos con el vuelto y el redondeo, y el QR con los datos de SUNAT
 * que ya se conocen. En 6a dice "Comprobante pendiente de envío a SUNAT" (6b lo reemplaza).
 *
 * Los montos son los guardados en el comprobante: aquí solo se les da formato, no se calcula nada. El ancho (32 o 48
 * columnas) y el juego de caracteres (con `SIN_TILDES` incluido) los resuelve el renderizador al entregar.
 */

/** Lo que el ticket toma del comprobante; `ComprobanteRespuesta` (contratos) lo cumple tal cual. */
export interface ComprobanteParaTicket {
  tipo: TipoDocumentoElectronico;
  serie: string;
  correlativo: number;
  /** `B001-00000124`. */
  numero: string;
  /** `AAAA-MM-DD`, la fecha de emisión de Lima. */
  fechaEmision: string;
  emisor: { ruc: string; razonSocial: string };
  sucursal: { nombre: string; direccion: string };
  cliente: {
    tipoDocumento: 'DNI' | 'CE' | 'PASAPORTE' | 'RUC';
    numero: string;
    nombre: string;
    direccion: string | null;
  } | null;
  /** `null` con un emisor Nuevo RUS (sin desglose de IGV). */
  tasaIgv: string | null;
  lineas: readonly {
    cantidad: number;
    descripcion: string;
    bruto: string;
    descuento: string;
    gratuita: boolean;
  }[];
  totales: {
    descuentos: string;
    operaciones: {
      gravadas: string;
      exoneradas: string;
      inafectas: string;
      gratuitas: string;
    } | null;
    igv: string;
    icbper: string;
    total: string;
  };
  montoEnLetras: string;
  orden: { mesas: readonly string[]; mozo: string | null; numeroLlamado: number | null } | null;
  /** Solo en una nota de crédito (6b, criterio 157): el documento que modifica. */
  afectaA?: { tipo: TipoDocumentoElectronico; numero: string } | null;
  /** Solo en una nota de crédito (6b, criterio 157): su tipo y el motivo que escribió quien la emitió. */
  nota?: { tipo: 'ANULACION' | 'DEVOLUCION'; motivo: string } | null;
}

/** Lo que el ticket toma del cobro y del momento de la emisión. */
export interface ContextoDeComprobante {
  /** Hora de emisión en la hora local de la sucursal (`20:15`). */
  hora: string;
  pagos: readonly { medio: MedioPago; monto: string; recibido: string | null }[];
  vuelto: string;
  redondeo: string;
  /** El ticket empieza con el pulso de la gaveta (efectivo e impresora con gaveta, criterio 92). */
  abreGaveta: boolean;
  /**
   * Solo en una nota de crédito con devolución (6b, criterio 157): lo que se devolvió por cada medio y el redondeo del
   * efectivo. Reemplaza a los pagos del cobro.
   */
  devolucion?: {
    pagos: readonly { medio: MedioPago; monto: string }[];
    redondeo: string;
  } | null;
}

export const TEXTO_PENDIENTE_DE_ENVIO = 'Comprobante pendiente de envío a SUNAT';

const NOMBRE_DEL_TIPO = {
  BOLETA: 'BOLETA DE VENTA ELECTRÓNICA',
  FACTURA: 'FACTURA ELECTRÓNICA',
  NOTA_CREDITO_BOLETA: 'NOTA DE CRÉDITO ELECTRÓNICA',
  NOTA_CREDITO_FACTURA: 'NOTA DE CRÉDITO ELECTRÓNICA',
} as const;

/** Cómo se nombra el documento que modifica una nota de crédito ("Modifica: BOLETA B001-00000124"). */
const NOMBRE_CORTO_DEL_TIPO = {
  BOLETA: 'BOLETA',
  FACTURA: 'FACTURA',
  NOTA_CREDITO_BOLETA: 'NOTA DE CRÉDITO',
  NOTA_CREDITO_FACTURA: 'NOTA DE CRÉDITO',
} as const;

/** Códigos de SUNAT del tipo de comprobante y del documento del cliente (catálogos 01 y 06). */
const CODIGO_DE_COMPROBANTE = {
  BOLETA: '03',
  FACTURA: '01',
  NOTA_CREDITO_BOLETA: '07',
  NOTA_CREDITO_FACTURA: '07',
} as const;
const CODIGO_DE_DOCUMENTO = { DNI: '1', CE: '4', RUC: '6', PASAPORTE: '7' } as const;

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return anio === undefined || mes === undefined || dia === undefined
    ? fecha
    : `${dia}/${mes}/${anio}`;
}

/**
 * El texto del QR con los datos que ya se conocen (formato de SUNAT): RUC del emisor, tipo, serie, número, IGV, total,
 * fecha de emisión y documento del cliente (`0` y `-` sin cliente). El ticket no lleva el `hash` (llega después de
 * imprimirlo); el PDF, que se arma al aceptarse, lo agrega al final si el PSE lo dio (criterio 159). Nunca pasa del máximo
 * de un QR.
 */
export function textoDelQr(c: ComprobanteParaTicket, hash: string | null = null): string {
  const cliente = c.cliente;
  const texto = [
    c.emisor.ruc,
    CODIGO_DE_COMPROBANTE[c.tipo],
    c.serie,
    String(c.correlativo).padStart(8, '0'),
    c.totales.igv,
    c.totales.total,
    c.fechaEmision,
    cliente === null ? '0' : CODIGO_DE_DOCUMENTO[cliente.tipoDocumento],
    cliente === null ? '-' : cliente.numero,
    ...(hash === null ? [] : [hash]),
    '',
  ]
    .map((parte) => limpiarTexto(parte.replace(/\|/g, ' ')))
    .join('|');
  return Array.from(texto).slice(0, LARGO_TEXTO_QR_TICKET).join('');
}

function encabezadoDe(c: ComprobanteParaTicket, ctx: ContextoDeComprobante): BloqueTicket[] {
  const bloques: BloqueTicket[] = [];
  if (ctx.abreGaveta) bloques.push({ tipo: 'gaveta' });
  bloques.push(
    { tipo: 'titulo', texto: limpiarTexto(c.emisor.razonSocial) },
    { tipo: 'linea', texto: `RUC: ${limpiarTexto(c.emisor.ruc)}`, alinear: 'centro' },
    { tipo: 'linea', texto: limpiarTexto(c.sucursal.nombre), alinear: 'centro' },
    { tipo: 'linea', texto: limpiarTexto(c.sucursal.direccion), alinear: 'centro' },
    { tipo: 'regla', caracter: '-' },
    { tipo: 'linea', texto: NOMBRE_DEL_TIPO[c.tipo], negrita: true, alinear: 'centro' },
    { tipo: 'linea', texto: limpiarTexto(c.numero), negrita: true, alinear: 'centro' },
    {
      tipo: 'columnas',
      izquierda: `Fecha: ${fechaCorta(c.fechaEmision)}`,
      derecha: limpiarTexto(ctx.hora),
    },
  );
  // Nota de crédito (6b, criterio 157): el documento que modifica y el motivo.
  if (c.afectaA !== undefined && c.afectaA !== null) {
    const modificado = c.afectaA;
    bloques.push({
      tipo: 'linea',
      texto: limpiarTexto(
        `Modifica: ${NOMBRE_CORTO_DEL_TIPO[modificado.tipo]} ${modificado.numero}`,
      ),
    });
  }
  if (c.nota !== undefined && c.nota !== null) {
    bloques.push({ tipo: 'linea', texto: limpiarTexto(`Motivo: ${c.nota.motivo}`) });
  }
  const cliente = c.cliente;
  if (cliente !== null) {
    bloques.push(
      { tipo: 'linea', texto: limpiarTexto(`Cliente: ${cliente.nombre}`) },
      { tipo: 'linea', texto: limpiarTexto(`${cliente.tipoDocumento}: ${cliente.numero}`) },
    );
    if (cliente.direccion !== null && limpiarTexto(cliente.direccion).length > 0) {
      bloques.push({ tipo: 'linea', texto: limpiarTexto(`Dirección: ${cliente.direccion}`) });
    }
  }
  const orden = c.orden;
  if (orden !== null) {
    if (orden.numeroLlamado !== null) {
      bloques.push({ tipo: 'titulo', texto: `LLAMADO ${orden.numeroLlamado}` });
    } else {
      for (const texto of lineasDeMesas(orden.mesas, false)) bloques.push({ tipo: 'linea', texto });
      if (orden.mozo !== null) {
        bloques.push({ tipo: 'linea', texto: limpiarTexto(`Mozo: ${orden.mozo}`) });
      }
    }
  }
  bloques.push({ tipo: 'regla', caracter: '-' });
  return bloques;
}

function cuerpoDe(c: ComprobanteParaTicket): BloqueTicket[] {
  const bloques: BloqueTicket[] = [];
  for (const l of c.lineas) {
    bloques.push({
      tipo: 'columnas',
      izquierda: limpiarTexto(`${l.cantidad} × ${l.descripcion}`),
      derecha: l.gratuita ? 'Cortesía' : formatoMonto(l.bruto),
      derechaAlFinal: true,
    });
    if (!l.gratuita && !esCero(l.descuento)) {
      bloques.push({
        tipo: 'columnas',
        izquierda: '  Descuento',
        derecha: `-${formatoMonto(l.descuento)}`,
      });
    }
  }
  return bloques;
}

/** Las líneas empaquetadas en pocos bloques, último recurso de un comprobante con miles de líneas. */
function cuerpoEmpaquetado(c: ComprobanteParaTicket): BloqueTicket[] {
  return juntarEnLineas(
    c.lineas.map(
      (l) =>
        `${limpiarTexto(`${l.cantidad} × ${l.descripcion}`)}  ${l.gratuita ? 'Cortesía' : formatoMonto(l.bruto)}`,
    ),
    ' | ',
  ).map((texto): BloqueTicket => ({ tipo: 'linea', texto }));
}

function totalesDe(c: ComprobanteParaTicket): BloqueTicket[] {
  const t = c.totales;
  const bloques: BloqueTicket[] = [{ tipo: 'regla', caracter: '-' }];
  const fila = (izquierda: string, monto: string): void => {
    bloques.push({ tipo: 'columnas', izquierda, derecha: formatoMonto(monto) });
  };
  if (!esCero(t.descuentos)) fila('Descuentos', `-${t.descuentos}`);
  const op = t.operaciones;
  if (op !== null) {
    if (!esCero(op.gravadas)) fila('Op. gravadas', op.gravadas);
    if (!esCero(op.exoneradas)) fila('Op. exoneradas', op.exoneradas);
    if (!esCero(op.inafectas)) fila('Op. inafectas', op.inafectas);
    if (!esCero(op.gratuitas)) fila('Op. gratuitas', op.gratuitas);
    fila(
      c.tasaIgv === null ? 'IGV' : `IGV (${formatoMonto(c.tasaIgv).replace(/\.00$/, '')}%)`,
      t.igv,
    );
  }
  if (!esCero(t.icbper)) fila('ICBPER', t.icbper);
  bloques.push(
    { tipo: 'regla', caracter: '=' },
    { tipo: 'columnas', izquierda: 'TOTAL S/', derecha: formatoMonto(t.total), negrita: true },
    { tipo: 'linea', texto: limpiarTexto(`SON: ${c.montoEnLetras}`) },
  );
  return bloques;
}

/** Lo que se devolvió, por medio, con el redondeo del efectivo (nota de crédito con devolución, criterio 157). */
function devolucionDe(ctx: ContextoDeComprobante): BloqueTicket[] {
  const devolucion = ctx.devolucion;
  if (devolucion === undefined || devolucion === null || devolucion.pagos.length === 0) return [];
  const bloques: BloqueTicket[] = [
    { tipo: 'regla', caracter: '-' },
    { tipo: 'linea', texto: 'DEVOLUCIÓN', negrita: true },
  ];
  for (const p of devolucion.pagos) {
    bloques.push({
      tipo: 'columnas',
      izquierda: ETIQUETA_DE_MEDIO[p.medio],
      derecha: formatoMonto(p.monto),
    });
  }
  if (!esCero(devolucion.redondeo)) {
    bloques.push({
      tipo: 'columnas',
      izquierda: 'Redondeo',
      derecha: `-${formatoMonto(devolucion.redondeo)}`,
    });
  }
  return bloques;
}

function pagosDe(ctx: ContextoDeComprobante): BloqueTicket[] {
  const bloques: BloqueTicket[] = [];
  if (ctx.pagos.length > 0) {
    bloques.push({ tipo: 'regla', caracter: '-' });
    for (const p of ctx.pagos) {
      bloques.push({
        tipo: 'columnas',
        izquierda: ETIQUETA_DE_MEDIO[p.medio],
        derecha: formatoMonto(p.monto),
      });
      if (p.medio === 'EFECTIVO' && p.recibido !== null) {
        bloques.push({
          tipo: 'columnas',
          izquierda: '  Recibido',
          derecha: formatoMonto(p.recibido),
        });
      }
    }
  }
  if (!esCero(ctx.redondeo)) {
    bloques.push({
      tipo: 'columnas',
      izquierda: 'Redondeo',
      derecha: `-${formatoMonto(ctx.redondeo)}`,
    });
  }
  if (!esCero(ctx.vuelto)) {
    bloques.push({ tipo: 'columnas', izquierda: 'Vuelto', derecha: formatoMonto(ctx.vuelto) });
  }
  return bloques;
}

function pieDe(c: ComprobanteParaTicket, ctx: ContextoDeComprobante): BloqueTicket[] {
  return [
    ...totalesDe(c),
    ...pagosDe(ctx),
    ...devolucionDe(ctx),
    { tipo: 'espacio' },
    { tipo: 'qr', texto: textoDelQr(c) },
    { tipo: 'espacio' },
    { tipo: 'linea', texto: TEXTO_PENDIENTE_DE_ENVIO, alinear: 'centro' },
  ];
}

export function documentoDeComprobante(
  comprobante: ComprobanteParaTicket,
  contexto: ContextoDeComprobante,
): DocumentoTicket {
  // Nunca pasa de `PRESUPUESTO_DE_BLOQUES`: con miles de líneas se empaquetan; el total y el QR siempre salen.
  const bloques = ajustarAlPresupuesto(
    encabezadoDe(comprobante, contexto),
    [() => cuerpoDe(comprobante), () => cuerpoEmpaquetado(comprobante)],
    pieDe(comprobante, contexto),
  );
  return { version: VERSION_DOCUMENTO_TICKET, tipo: 'COMPROBANTE', bloques };
}
