import type { TipoComprobante } from './caja/catalogos';

/** Régimen tributario del emisor; define qué comprobantes puede emitir (RF-65, historia de facturación). */
export const REGIMENES_TRIBUTARIOS = ['NUEVO_RUS', 'RER', 'MYPE_TRIBUTARIO', 'GENERAL'] as const;

export type RegimenTributario = (typeof REGIMENES_TRIBUTARIOS)[number];

/**
 * Tipos de comprobante que puede emitir un emisor según su régimen (RF-65, historia 006, criterio 51): el Nuevo RUS
 * solo emite boletas; los demás, boletas y facturas. FIRMA de la fase A.
 */
export function tiposDeComprobantePermitidos(
  _regimen: RegimenTributario,
): readonly TipoComprobante[] {
  throw new Error('No implementado');
}
