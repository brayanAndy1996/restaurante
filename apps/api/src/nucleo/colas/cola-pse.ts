/**
 * La cola de envíos al PSE (historia 006, entrega 6b, criterios 124 a 126 y 137). Puerto con dos implementaciones:
 * `ColaPgBoss` (producción, con el rol `restaurante_colas` y el esquema `colas`) y `ColaEnMemoria` (pruebas y
 * `NODE_ENV=test`, que guarda los trabajos sin procesarlos). El trabajo lleva solo `{ empresaId, comprobanteId }`
 * (criterio 163): nunca datos de clientes.
 */

/** Token de Nest de la cola de envíos al PSE. */
export const COLA_PSE = Symbol('COLA_PSE');

/** Nombre del trabajo de envío al PSE en la cola. */
export const TRABAJO_ENVIO_PSE = 'envio-pse';

/** La carga de un trabajo `envio-pse`: nada más que estos dos ids. */
export interface TrabajoEnvioPse {
  empresaId: string;
  comprobanteId: string;
}

export interface OpcionesDeEncolado {
  /** No procesarlo antes de este instante (el siguiente reintento). */
  startAfter?: Date;
}

/** Quien procesa un trabajo: el worker llama a `ProcesadorEnviosPse.procesar`. */
export type ProcesadorDeTrabajo = (trabajo: TrabajoEnvioPse) => Promise<void>;

export interface ColaPse {
  /**
   * Encola el envío de un comprobante. Se llama con `alConfirmar`, después de confirmar la transacción: si falla, el
   * barrido lo encuentra (criterio 126).
   */
  encolar(trabajo: TrabajoEnvioPse, opciones?: OpcionesDeEncolado): Promise<void>;
  /** Registra quién procesa los trabajos (solo lo hace el worker). */
  trabajar(procesador: ProcesadorDeTrabajo): Promise<void>;
  /** Deja de recibir y de procesar trabajos. */
  detener(): Promise<void>;
}
