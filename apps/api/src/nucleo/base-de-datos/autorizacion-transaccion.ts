/**
 * Quién puede autorizar una transacción de la API (criterio 22c).
 *
 * Una transacción de la API solo puede enviar consultas a la base después de fijar la empresa, y esa
 * fijación solo vale si la hace `ContextoEmpresa.ejecutar` al abrir un contexto nuevo (cuando no hay
 * contexto vigente). El texto de la sentencia no prueba nada: `fn` puede abrir otra transacción con
 * `sequelize.transaction()` y mandar el mismo texto con otra empresa. Por eso `ejecutar` registra aquí
 * su propia transacción, antes de mandar la sentencia, como "pendiente de autorizar", y la guarda
 * (`guarda-api.ts`) solo acepta la fijación de una transacción pendiente. El registro es de un solo
 * uso: la guarda lo consume al recibir la sentencia, así que no se puede fijar dos veces.
 *
 * Este archivo solo lo importan `ContextoEmpresa` y la guarda; una regla de ESLint prohíbe
 * importarlo fuera de `src/nucleo/`, y no sale por el `index.ts` de la carpeta.
 */
import type { Transaction } from 'sequelize';

const pendientes = new WeakSet<Transaction>();

/** `ContextoEmpresa.ejecutar` declara que va a fijar la empresa en esta transacción recién abierta. */
export function registrarPendienteDeAutorizar(transaccion: Transaction): void {
  pendientes.add(transaccion);
}

/** La guarda consume el registro: `true` solo la primera vez y solo si `ejecutar` lo registró. */
export function consumirPendienteDeAutorizar(transaccion: Transaction): boolean {
  return pendientes.delete(transaccion);
}
