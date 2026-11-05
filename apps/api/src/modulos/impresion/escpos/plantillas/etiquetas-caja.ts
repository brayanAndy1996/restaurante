import type { MedioPago } from '@restaurante/dominio';

/** Cómo se llama cada medio de pago en los tickets de caja (el comprobante, el X y la Z). */
export const ETIQUETA_DE_MEDIO: Readonly<Record<MedioPago, string>> = {
  EFECTIVO: 'Efectivo',
  TARJETA_CREDITO: 'Tarjeta de crédito',
  TARJETA_DEBITO: 'Tarjeta de débito',
  YAPE: 'Yape',
  PLIN: 'Plin',
};

/** `true` si el monto (texto con decimales) es cero. */
export function esCero(monto: string): boolean {
  return /^-?0+(?:\.0*)?$/.test(monto.trim());
}
