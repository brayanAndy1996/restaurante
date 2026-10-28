import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transaction } from 'sequelize';

/**
 * Estado de la operación en curso, guardado en el `AsyncLocalStorage` de Node. Lo fija
 * `ContextoEmpresa.ejecutar` (empresa y transacción de la API) o `OperacionPlataforma.ejecutar`
 * (`plataforma: true`). Nunca hay las dos cosas a la vez.
 *
 * Estar aquí no autoriza nada por sí solo: la guarda de la API solo acepta transacciones que
 * `ContextoEmpresa.ejecutar` registró para autorizar (ver `autorizacion-transaccion.ts`).
 *
 * El estado vive tanto como la operación que lo creó. Las continuaciones asíncronas que `fn` dejó
 * vivas (una promesa diferida, un temporizador, un efecto secundario posterior a la confirmación)
 * heredan el almacén aunque la operación ya terminó; por eso quien lo crea lo marca con `terminado`
 * al cerrar, y `estadoActual()` trata un estado terminado como ausente (criterio 27b).
 */
export interface EstadoOperacion {
  /** Empresa del contexto activo (UUID en minúsculas). */
  readonly empresaId?: string;
  /** Transacción de la API abierta por `ContextoEmpresa.ejecutar`. */
  readonly transaccion?: Transaction;
  /** Hay una operación de plataforma en curso. */
  readonly plataforma?: true;
  /**
   * Efectos secundarios registrados con `ContextoEmpresa.alConfirmar`. Viven en el estado de la operación
   * dueña de la transacción (no en la `Transaction` de Sequelize, cuyo `afterCommit` corre también cuando el
   * `COMMIT` falla) y solo corren cuando su `COMMIT` volvió sin error.
   */
  readonly efectos?: Array<() => void | Promise<void>>;
  /** La operación que creó este estado ya cerró su transacción: el estado equivale a ninguno. */
  terminado?: true;
}

const almacen = new AsyncLocalStorage<EstadoOperacion>();

/** Corre `fn` (y todo lo que esta lance de forma asíncrona) con `estado` como estado vigente. */
export function ejecutarConEstado<T>(estado: EstadoOperacion, fn: () => Promise<T>): Promise<T> {
  return almacen.run(estado, fn);
}

/** Marca el estado como terminado: desde ahora nadie que lo herede tiene contexto ni operación. */
export function terminarEstado(estado: EstadoOperacion): void {
  estado.terminado = true;
}

/** Estado vigente, o `undefined` fuera de cualquier contexto u operación o si ya terminó. */
export function estadoActual(): EstadoOperacion | undefined {
  const estado = almacen.getStore();
  return estado?.terminado ? undefined : estado;
}
