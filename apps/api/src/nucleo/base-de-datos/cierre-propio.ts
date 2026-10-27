/**
 * Cierre propio de la transacción de `ContextoEmpresa.ejecutar` (criterio 22b).
 *
 * Una vez autorizada la transacción (fijada la empresa), el código de `fn` no puede confirmarla ni
 * revertirla por SQL: solo `ContextoEmpresa.ejecutar` lo hace, por estas dos funciones. La marca solo
 * vale mientras se llama a `commit()`/`rollback()`: ambas mandan la sentencia de forma síncrona, antes
 * del primer `await`, y la guarda de la API (`guarda-api.ts`) la mira en ese mismo instante. Al volver
 * la llamada la marca se retira, así que un `COMMIT` que `fn` mande después no pasa.
 */
import type { Transaction } from 'sequelize';

const cerrando = new WeakSet<Transaction>();

/** `true` si la transacción está mandando en este instante su propio `COMMIT` o `ROLLBACK`. */
export function estaCerrandoPropio(transaccion: Transaction): boolean {
  return cerrando.has(transaccion);
}

function cerrar(transaccion: Transaction, como: 'commit' | 'rollback'): Promise<void> {
  cerrando.add(transaccion);
  try {
    return como === 'commit' ? transaccion.commit() : transaccion.rollback();
  } finally {
    cerrando.delete(transaccion);
  }
}

/** Confirma la transacción (única vía autorizada para el `COMMIT` dentro de un contexto). */
export function confirmarPropia(transaccion: Transaction): Promise<void> {
  return cerrar(transaccion, 'commit');
}

/** Revierte la transacción (única vía autorizada para el `ROLLBACK` dentro de un contexto). */
export function revertirPropia(transaccion: Transaction): Promise<void> {
  return cerrar(transaccion, 'rollback');
}
