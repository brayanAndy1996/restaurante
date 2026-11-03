/**
 * Límites de creación de llamados (historia 005, criterios 32, 33 y 56; ruta crítica P2). Firma pública: la
 * implementación llega en la fase C (T8).
 */
import type { LimiteDeLlamados } from './catalogos';

export type ResultadoLimite =
  { permitido: true } | { permitido: false; reintentarEnSegundos: number };

/**
 * `{ permitido: true }` si hay menos de `limite.maximo` instantes en `(ahora − ventana, ahora]`; si no,
 * `{ permitido: false, reintentarEnSegundos }` con los segundos (hacia arriba, mínimo 1) hasta que el más antiguo
 * de la ventana salga de ella.
 */
export function decidirLimite(
  instantes: readonly Date[],
  ahora: Date,
  limite: LimiteDeLlamados,
): ResultadoLimite {
  void instantes;
  void ahora;
  void limite;
  throw new Error('No implementado');
}
