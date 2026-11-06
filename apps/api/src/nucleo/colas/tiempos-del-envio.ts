import { PSE_TIMEOUT_MS_MAXIMO } from '../../config/entorno';
import { TIEMPO_LIMITE_R2_MS } from '../archivos/almacen-r2';

/**
 * Los tiempos del envío al PSE (historia 006, criterio 125), en un solo lugar para que el arriendo del envío y la expiración
 * del trabajo de la cola salgan de las mismas cuentas.
 *
 * El paso 2 del procesamiento (fuera de toda transacción) hace, en el peor caso, dos llamadas al PSE (consultar y emitir),
 * cada una con el tiempo máximo `PSE_TIMEOUT_MS`, y guarda dos archivos (el XML y el CDR) en el almacén, cada uno con su
 * tiempo límite `TIEMPO_LIMITE_R2_MS`. Mientras tanto ningún otro worker debe tomar el envío.
 */

/** El arriendo mínimo de un envío (criterio 125): el de siempre, 2 minutos. */
export const ARRIENDO_ENVIO_MINIMO_MS = 2 * 60_000;
/** Margen del arriendo sobre el peor caso del paso 2: guardar el resultado en la base y los relojes de los workers. */
export const MARGEN_DEL_ARRIENDO_MS = 30_000;
/** Margen de la expiración de la cola sobre el arriendo más largo: la cola nunca da por perdido un trabajo que sigue vivo. */
export const MARGEN_DE_EXPIRACION_MS = 60_000;

/**
 * Cuánto dura el arriendo de un envío: `max(2 min, 2 × PSE_TIMEOUT_MS + 2 × TIEMPO_LIMITE_R2_MS + margen)`.
 */
export function arriendoDelEnvioMs(tiempoMaximoPseMs: number): number {
  return Math.max(
    ARRIENDO_ENVIO_MINIMO_MS,
    2 * tiempoMaximoPseMs + 2 * TIEMPO_LIMITE_R2_MS + MARGEN_DEL_ARRIENDO_MS,
  );
}

/**
 * Segundos que pg-boss deja activo un trabajo `envio-pse` antes de darlo por perdido. La cola se crea una vez para todos los
 * procesos, así que se calcula con el mayor `PSE_TIMEOUT_MS` que admite la configuración: siempre supera, con margen, el arriendo
 * de cualquier valor permitido.
 */
export const EXPIRA_ENVIO_EN_SEGUNDOS = Math.ceil(
  (arriendoDelEnvioMs(PSE_TIMEOUT_MS_MAXIMO) + MARGEN_DE_EXPIRACION_MS) / 1000,
);
