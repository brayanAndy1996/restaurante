/** Valores vigentes por fecha (historia 006, criterio 10; ruta crítica P1). */
import { MONTOS_ICBPER } from './catalogos';
import { dos, fecha, tasa } from './comun';

/** Una tasa de IGV de un emisor desde una fecha. */
export interface TasaIgvDesde {
  /** Fecha `AAAA-MM-DD`. */
  desde: string;
  /** Porcentaje con 2 decimales (`"18.00"`). */
  tasa: string;
}

/** La tasa con el mayor `desde` menor o igual que `fecha`, o `null` si no hay ninguna (criterio 10). */
export function tasaIgvVigente(
  tasas: readonly TasaIgvDesde[],
  fechaConsulta: string,
): string | null {
  const dia = fecha(fechaConsulta, 'La fecha');
  if (!Array.isArray(tasas)) throw new RangeError('Las tasas deben ser una lista');
  let vigente: { desde: string; tasa: string } | null = null;
  for (const t of tasas) {
    if (typeof t !== 'object' || t === null) throw new RangeError('La tasa no es válida');
    const desde = fecha(t.desde, 'La fecha de inicio de la tasa');
    const valor = dos(tasa(t.tasa, 'La tasa de IGV'));
    if (desde <= dia && (vigente === null || desde > vigente.desde)) {
      vigente = { desde, tasa: valor };
    }
  }
  return vigente === null ? null : vigente.tasa;
}

/** El monto del ICBPER por bolsa de `MONTOS_ICBPER` vigente en `fecha`; antes de la primera, `RangeError`. */
export function montoIcbperVigente(fechaConsulta: string): string {
  const dia = fecha(fechaConsulta, 'La fecha');
  let vigente: { desde: string; monto: string } | null = null;
  for (const fila of MONTOS_ICBPER) {
    if (fila.desde <= dia && (vigente === null || fila.desde > vigente.desde)) vigente = fila;
  }
  if (vigente === null) {
    throw new RangeError(`No hay monto de ICBPER vigente el ${dia}`);
  }
  return vigente.monto;
}
