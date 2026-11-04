import type { ObjetivoAutorizacion } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import type { AutorizacionConsumida } from './autorizacion.service';

/**
 * Compara el objetivo de la autorización que `@Permiso` consumió con el objetivo que se está ejecutando (historia 006,
 * criterio 40, pregunta 9): los descuentos y las cortesías de Mozo y Cajero solo valen con una clave atada a
 * exactamente esa cuenta, ese ítem y ese descuento o esa cantidad. Distinto, de otra acción o ausente: 403
 * `AUTORIZACION_INVALIDA` (la reversión de la transacción devuelve la autorización). Quien aplica sin clave
 * (`consumida` `undefined`: Supervisor y Administrador) pasa. FIRMA de la fase A.
 */
export function exigirObjetivo(
  _consumida: AutorizacionConsumida | undefined,
  _esperado: ObjetivoAutorizacion,
): void {
  throw noImplementado();
}
