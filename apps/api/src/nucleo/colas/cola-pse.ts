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

/** Nombre del trabajo de carga del padrón de RUC en la cola (criterio 138): sin datos, uno a la vez. */
export const TRABAJO_PADRON_RUC = 'padron-ruc';

/** Lo que el worker hace al recibir el trabajo `padron-ruc`: `CargaPadron.cargar()`. */
export type ProcesadorDeCargaDePadron = () => Promise<void>;

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
  /**
   * Pide una carga del padrón de RUC ahora (`POST /plataforma/padron/carga`). Si ya hay una esperando o en curso no encola
   * otra: la cola deja a lo más una carga a la vez (criterio 138).
   */
  pedirCargaDePadron(): Promise<void>;
  /**
   * Solo el worker: programa la carga diaria (`0 4 * * *`, hora de Lima) y registra quién procesa el trabajo `padron-ruc`
   * (criterio 138).
   */
  programarPadron(procesador: ProcesadorDeCargaDePadron): Promise<void>;
  /** Deja de recibir y de procesar trabajos. */
  detener(): Promise<void>;
}
