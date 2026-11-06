import type {
  AlertasRespuesta,
  ComprobanteDetalle,
  ComprobanteRespuesta,
  EnvioPseRespuesta,
  PanelItem,
} from '@restaurante/contratos';
import { ID } from './ayudas';
import { uuid } from './ayudas-salon';

/** Un comprobante de ejemplo con la forma de `comprobanteRespuestaSchema` (con los campos de 6b). */
export function comprobanteDe(extra: Partial<ComprobanteRespuesta> = {}): ComprobanteRespuesta {
  return {
    id: uuid(7000),
    tipo: 'BOLETA',
    serie: 'B001',
    correlativo: 124,
    numero: 'B001-00000124',
    formato: 'DETALLADO',
    estado: 'POR_ENVIAR',
    fechaEmision: '2026-11-05',
    emitidoEn: '2026-11-06T00:10:00.000Z',
    diaOperativo: '2026-11-05',
    emisor: { ruc: '20100070970', razonSocial: 'Cevichería Sol S.A.C.', regimen: 'GENERAL' },
    sucursal: { nombre: 'Miraflores', direccion: 'Av. Larco 123', codigoEstablecimiento: '0000' },
    cajaId: uuid(101),
    turnoId: uuid(300),
    turnoResponsableId: ID.usuario,
    cobroId: uuid(8000),
    numeroParte: 1,
    cliente: null,
    moneda: 'PEN',
    tasaIgv: '18.00',
    lineas: [],
    totales: {
      subtotal: '68.50',
      descuentos: '0.00',
      operaciones: null,
      igv: '0.00',
      igvGratuitas: '0.00',
      icbper: '0.00',
      total: '68.50',
    },
    montoEnLetras: 'SON: SESENTA Y OCHO CON 50/100 SOLES',
    orden: null,
    ...extra,
  };
}

export function envioDe(extra: Partial<EnvioPseRespuesta> = {}): EnvioPseRespuesta {
  return {
    estado: 'PENDIENTE',
    intentos: 0,
    proximoIntentoEn: '2026-11-06T00:10:00.000Z',
    plazoHasta: '2026-11-09T04:59:59.999Z',
    ultimoResultado: null,
    ultimoError: null,
    ...extra,
  };
}

/** `GET /facturacion/comprobantes/:id`: el comprobante con su envío y sus intentos. */
export function detalleDe(extra: Partial<ComprobanteDetalle> = {}): ComprobanteDetalle {
  return { ...comprobanteDe(), envio: envioDe(), intentos: [], ...extra };
}

export function alertasDe(extra: Partial<AlertasRespuesta> = {}): AlertasRespuesta {
  return {
    rechazados: 0,
    demorados: 0,
    detenidos: 0,
    sinConfiguracion: 0,
    modoSimulado: false,
    ...extra,
  };
}

/** Un ítem del panel de comprobantes (`panelItemSchema`). */
export function itemDePanel(extra: Partial<PanelItem> = {}): PanelItem {
  return {
    id: uuid(7000),
    tipo: 'BOLETA',
    numero: 'B001-00000124',
    estado: 'ACEPTADO',
    simulado: false,
    total: '68.50',
    fechaEmision: '2026-11-05',
    emitidoEn: '2026-11-06T00:10:00.000Z',
    cliente: null,
    sucursal: { id: ID.sucursalA, nombre: 'Miraflores' },
    alerta: null,
    envio: envioDe({
      estado: 'TERMINADO',
      intentos: 1,
      proximoIntentoEn: null,
      ultimoResultado: 'ACEPTADO',
    }),
    sunat: null,
    afectaA: null,
    reemplazaA: null,
    reemplazadoPor: null,
    ...extra,
  };
}

/** Una línea de comprobante con la forma de `comprobanteLineaRespuestaSchema`. */
export function lineaDeComprobante(
  extra: Partial<ComprobanteRespuesta['lineas'][number]> = {},
): ComprobanteRespuesta['lineas'][number] {
  return {
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
    posicionOrigen: null,
    ...extra,
  };
}

/**
 * Una boleta aceptada de S/ 66.20 con cuatro líneas, como la cuenta C de 004 más una cortesía: Lomo saltado × 2,
 * Gaseosa × 1, Bolsa plástica × 2 (con ICBPER) y un postre de cortesía (gratuito). Sin notas de crédito.
 */
export function boletaAceptada(extra: Partial<ComprobanteDetalle> = {}): ComprobanteDetalle {
  return detalleDe({
    estado: 'ACEPTADO',
    envio: envioDe({ estado: 'TERMINADO', intentos: 1, ultimoResultado: 'ACEPTADO' }),
    lineas: [
      lineaDeComprobante({
        posicion: 1,
        descripcion: 'Lomo saltado',
        cantidad: 2,
        bruto: '56.00',
        neto: '56.00',
        base: '47.46',
        igv: '8.54',
      }),
      lineaDeComprobante({
        posicion: 2,
        descripcion: 'Gaseosa 1 L',
        precioUnitario: '9.00',
        bruto: '9.00',
        neto: '9.00',
        base: '7.63',
        igv: '1.37',
      }),
      lineaDeComprobante({
        posicion: 3,
        descripcion: 'Bolsa plástica',
        cantidad: 2,
        precioUnitario: '0.10',
        bruto: '0.20',
        neto: '0.20',
        base: '0.17',
        igv: '0.03',
        bolsas: 2,
        icbper: '1.00',
      }),
      lineaDeComprobante({
        posicion: 4,
        descripcion: 'Postre de la casa (cortesía)',
        precioUnitario: '12.00',
        bruto: '0.00',
        neto: '0.00',
        base: '0.00',
        igv: '0.00',
        gratuita: true,
        valorReferencial: '12.00',
      }),
    ],
    totales: {
      subtotal: '65.20',
      descuentos: '0.00',
      operaciones: { gravadas: '55.26', exoneradas: '0.00', inafectas: '0.00', gratuitas: '10.17' },
      igv: '9.94',
      igvGratuitas: '1.83',
      icbper: '1.00',
      total: '66.20',
    },
    notasCredito: [],
    acreditado: [],
    ...extra,
  });
}
