/**
 * Límites de creación de llamados (historia 005, criterios 32, 33 y 56; ruta crítica P2). Regla pura: la API
 * entrega los instantes ya filtrados por mesa o por conexión y decide con el reloj propio.
 */
import type { LimiteDeLlamados } from './catalogos';

export type ResultadoLimite =
  { permitido: true } | { permitido: false; reintentarEnSegundos: number };

const MS_POR_MINUTO = 60_000;

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
  const fin = ahora.getTime();
  const inicio = fin - limite.ventanaMinutos * MS_POR_MINUTO;
  const enVentana = instantes.map((i) => i.getTime()).filter((t) => t > inicio && t <= fin);
  if (enVentana.length < limite.maximo) return { permitido: true };

  const masAntiguo = Math.min(...enVentana);
  const faltanMs = masAntiguo + limite.ventanaMinutos * MS_POR_MINUTO - fin;
  return { permitido: false, reintentarEnSegundos: Math.max(1, Math.ceil(faltanMs / 1000)) };
}
