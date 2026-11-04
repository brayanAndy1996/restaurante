/** Valores vigentes por fecha (historia 006, criterio 10; ruta crítica P1). FIRMAS de la fase A. */

/** Una tasa de IGV de un emisor desde una fecha. */
export interface TasaIgvDesde {
  /** Fecha `AAAA-MM-DD`. */
  desde: string;
  /** Porcentaje con 2 decimales (`"18.00"`). */
  tasa: string;
}

/** La tasa con el mayor `desde` menor o igual que `fecha`, o `null` si no hay ninguna (criterio 10). */
export function tasaIgvVigente(_tasas: readonly TasaIgvDesde[], _fecha: string): string | null {
  throw new Error('No implementado');
}

/** El monto del ICBPER por bolsa de `MONTOS_ICBPER` vigente en `fecha`; antes de la primera, `RangeError`. */
export function montoIcbperVigente(_fecha: string): string {
  throw new Error('No implementado');
}
