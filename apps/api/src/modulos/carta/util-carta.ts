/**
 * Ayudantes comunes de los servicios de la carta: instantes y diferencias para la auditoría. Sin montos
 * (los montos se normalizan y calculan con `packages/dominio`).
 */

/** Instante en el formato de los contratos (`z.iso.datetime()`). */
export const aIso = (fecha: Date | string): string => new Date(fecha).toISOString();

/** `antes` y `despues` de un campo que cambió (criterio 62). */
export interface Cambio {
  antes: unknown;
  despues: unknown;
}

/**
 * Los campos de `despues` que difieren de `antes`, como `{ campo: { antes, despues } }`. Vacío si no cambió
 * nada: la escritura es un no-op y no deja fila de auditoría (criterios 10, 16, 19, 35, 40 y 41). Los
 * montos van como texto en los dos lados, así que se comparan por texto.
 */
export function diferencias<T extends Record<string, unknown>>(
  antes: T,
  despues: T,
  campos: readonly (keyof T & string)[],
): Record<string, Cambio> {
  const cambios: Record<string, Cambio> = {};
  for (const campo of campos) {
    if (antes[campo] !== despues[campo]) {
      cambios[campo] = { antes: antes[campo] ?? null, despues: despues[campo] ?? null };
    }
  }
  return cambios;
}

/** `true` si las dos listas de ids tienen los mismos elementos en el mismo orden. */
export const sinCambioDeOrden = (
  actuales: readonly string[],
  pedidos: readonly string[],
): boolean => actuales.length === pedidos.length && actuales.every((id, i) => id === pedidos[i]);

/** El día (AAAA-MM-DD) que está `dias` días después de `dia` (negativo, antes). Aritmética de calendario pura. */
export function sumarDias(dia: string, dias: number): string {
  const [anio, mes, diaDelMes] = dia.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio!, mes! - 1, diaDelMes! + dias));
  return fecha.toISOString().slice(0, 10);
}
