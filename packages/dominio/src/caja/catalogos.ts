/**
 * Catálogos y límites de Caja, cobro y comprobantes (historia 006, entrega 6a). Son datos puros: los comparten
 * la API (validación y base de datos), los contratos (esquemas zod) y la PWA (etiquetas y formularios).
 */

/** Medios de pago (RF-51). Solo el efectivo da vuelto y mueve la gaveta. El orden es el de los reportes. */
export const MEDIOS_PAGO = [
  'EFECTIVO',
  'TARJETA_CREDITO',
  'TARJETA_DEBITO',
  'YAPE',
  'PLIN',
] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number];

/** Tipo de comprobante que emite 6a. Las notas de crédito las agrega 6b. */
export const TIPOS_COMPROBANTE = ['BOLETA', 'FACTURA'] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];

/** Una línea por ítem (`DETALLADO`) o una por afectación (`CONSUMO`). */
export const FORMATOS_COMPROBANTE = ['DETALLADO', 'CONSUMO'] as const;
export type FormatoComprobante = (typeof FORMATOS_COMPROBANTE)[number];

/** Documento del cliente de un comprobante (pregunta 15). */
export const TIPOS_DOCUMENTO_CLIENTE = ['DNI', 'CE', 'PASAPORTE', 'RUC'] as const;
export type TipoDocumentoCliente = (typeof TIPOS_DOCUMENTO_CLIENTE)[number];

/** Descuento en porcentaje o en monto. */
export const TIPOS_DESCUENTO = ['PORCENTAJE', 'MONTO'] as const;
export type TipoDescuento = (typeof TIPOS_DESCUENTO)[number];

/** Qué parte de la cuenta se cobra: todo lo que falta, unidades elegidas o el saldo dividido en partes iguales. */
export const TIPOS_PARTE = ['TOTAL', 'ITEMS', 'IGUALES'] as const;
export type TipoParte = (typeof TIPOS_PARTE)[number];

/** Modo en que se empezó a dividir una cuenta con cobros (`null` mientras no haya cobros). */
export const MODOS_COBRO = ['ITEMS', 'IGUALES'] as const;
export type ModoCobro = (typeof MODOS_COBRO)[number];

export const ESTADOS_TURNO = ['ABIERTO', 'CERRADO'] as const;
export type EstadoTurno = (typeof ESTADOS_TURNO)[number];

/** Estados de un comprobante. En 6a todo nace y se queda `POR_ENVIAR`; los demás los usa 6b. */
export const ESTADOS_COMPROBANTE = [
  'POR_ENVIAR',
  'ENVIADO',
  'ACEPTADO',
  'RECHAZADO',
  'ANULADO',
] as const;
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number];

/** Ingreso o egreso de efectivo del turno (RF-53). */
export const TIPOS_MOVIMIENTO_CAJA = ['INGRESO', 'EGRESO'] as const;
export type TipoMovimientoCaja = (typeof TIPOS_MOVIMIENTO_CAJA)[number];

/** Moneda de todo comprobante (fuera de alcance: otras monedas). */
export const MONEDA_COMPROBANTE = 'PEN';

/** Una boleta de más de este monto exige documento y nombre del cliente (RF-59). */
export const MONTO_BOLETA_SIN_DOCUMENTO = '700.00';
/** Cajas activas por sucursal (criterio 1). */
export const MAXIMO_CAJAS_SUCURSAL = 10;
/** Pagos en un cobro (criterio 47). */
export const MAXIMO_PAGOS_COBRO = 10;
/** Partes de una cuenta dividida en partes iguales (criterio 18). */
export const MAXIMO_PARTES_IGUALES = 50;
/** Ítems distintos en una parte por ítems (criterio 47). */
export const MAXIMO_ITEMS_PARTE = 200;
/** El pulso de la gaveta solo sale si el trabajo se entrega a menos de estos segundos de creado (criterio 94). */
export const SEGUNDOS_PULSO_GAVETA = 120;
/** Mayor correlativo de una serie (8 cifras, criterio 70). */
export const CORRELATIVO_MAXIMO = 99_999_999;
/** Tasa de IGV configurable por emisor, en porcentaje con 2 decimales (criterio 6). */
export const TASA_IGV_MINIMA = '0.01';
export const TASA_IGV_MAXIMA = '30.00';

/** Una vigencia del monto del ICBPER por bolsa plástica. */
export interface VigenciaIcbper {
  /** Fecha `AAAA-MM-DD` desde la que rige. */
  desde: string;
  /** Monto por bolsa, texto con 2 decimales. */
  monto: string;
}

/**
 * Montos del ICBPER por bolsa, en orden de `desde` (pregunta 5, por validar con el contador): `"0.50"` desde
 * 2023-01-01. Un cambio de ley agrega una fila; nunca se edita una vigente.
 */
export const MONTOS_ICBPER: readonly VigenciaIcbper[] = [{ desde: '2023-01-01', monto: '0.50' }];
