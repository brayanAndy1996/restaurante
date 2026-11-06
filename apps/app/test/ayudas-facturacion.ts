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
