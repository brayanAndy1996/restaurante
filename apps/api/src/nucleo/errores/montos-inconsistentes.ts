import { Logger } from '@nestjs/common';
import type { ErrorAplicacion } from './error-aplicacion';

const logger = new Logger('MontosInconsistentes');

/**
 * Corre un cálculo de montos de `packages/dominio` y convierte su `RangeError` (un dato malo: un saldo negativo, un
 * monto fuera de rango) en el error de negocio que `crearError` da, para que ninguna ruta responda 500 por ello
 * (historia 006, criterios 45a y 90). El dominio sigue lanzando `RangeError` (así detecta el dato malo); aquí solo se
 * registra el detalle en el log, con su contexto, y se responde un 409. Cualquier otro error pasa tal cual.
 */
export function conMontosConsistentes<T>(
  contexto: string,
  crearError: () => ErrorAplicacion,
  calcular: () => T,
): T {
  try {
    return calcular();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    logger.error(`Montos inconsistentes en ${contexto}: ${error.message}`);
    throw crearError();
  }
}
