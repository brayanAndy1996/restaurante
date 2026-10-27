import { AsyncLocalStorage } from 'node:async_hooks';
import type { Transaction } from 'sequelize';

/**
 * Estado de la operación en curso, guardado en el `AsyncLocalStorage` de Node. Lo fija
 * `ContextoEmpresa.ejecutar` (empresa y transacción de la API) o `OperacionPlataforma.ejecutar`
 * (`plataforma: true`). Nunca hay las dos cosas a la vez.
 *
 * Estar aquí no autoriza nada por sí solo: la guarda de la API solo acepta transacciones que ella
 * misma vio fijar el contexto de empresa (ver `guarda-api.ts`).
 */
export interface EstadoOperacion {
  /** Empresa del contexto activo (UUID en minúsculas). */
  readonly empresaId?: string;
  /** Transacción de la API abierta por `ContextoEmpresa.ejecutar`. */
  readonly transaccion?: Transaction;
  /** Hay una operación de plataforma en curso. */
  readonly plataforma?: true;
}

const almacen = new AsyncLocalStorage<EstadoOperacion>();

/** Corre `fn` (y todo lo que esta lance de forma asíncrona) con `estado` como estado vigente. */
export function ejecutarConEstado<T>(estado: EstadoOperacion, fn: () => Promise<T>): Promise<T> {
  return almacen.run(estado, fn);
}

/** Estado vigente, o `undefined` fuera de cualquier contexto u operación. */
export function estadoActual(): EstadoOperacion | undefined {
  return almacen.getStore();
}
