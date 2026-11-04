import type { TipoComprobante } from './caja/catalogos';

/** Régimen tributario del emisor; define qué comprobantes puede emitir (RF-65, historia de facturación). */
export const REGIMENES_TRIBUTARIOS = ['NUEVO_RUS', 'RER', 'MYPE_TRIBUTARIO', 'GENERAL'] as const;

export type RegimenTributario = (typeof REGIMENES_TRIBUTARIOS)[number];

const SOLO_BOLETAS: readonly TipoComprobante[] = Object.freeze(['BOLETA'] as const);
const BOLETAS_Y_FACTURAS: readonly TipoComprobante[] = Object.freeze([
  'BOLETA',
  'FACTURA',
] as const);

/**
 * Tipos de comprobante que puede emitir un emisor según su régimen (RF-65, historia 006, criterio 51): el Nuevo RUS
 * solo emite boletas; los demás, boletas y facturas. Un régimen fuera del catálogo es un `RangeError`.
 */
export function tiposDeComprobantePermitidos(
  regimen: RegimenTributario,
): readonly TipoComprobante[] {
  if (!(REGIMENES_TRIBUTARIOS as readonly unknown[]).includes(regimen)) {
    throw new RangeError('El régimen tributario no es válido');
  }
  return regimen === 'NUEVO_RUS' ? SOLO_BOLETAS : BOLETAS_Y_FACTURAS;
}
