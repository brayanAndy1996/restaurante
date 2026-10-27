import type { Transaction } from 'sequelize';

/**
 * Una transacción usa una sola conexión de PostgreSQL, y `pg` ya no admite (a partir de pg 9) mandar
 * una consulta mientras otra sigue en curso en la misma conexión. Dentro de un contexto es normal
 * lanzar varias consultas a la vez (`Promise.all`), así que se encolan por transacción: se ejecutan
 * una tras otra, en el orden en que se pidieron, y un fallo no frena a las siguientes.
 */
export class ColaPorTransaccion {
  private readonly colas = new WeakMap<Transaction, Promise<unknown>>();

  ejecutar<T>(transaccion: Transaction, tarea: () => Promise<T>): Promise<T> {
    const anterior = this.colas.get(transaccion) ?? Promise.resolve();
    const actual = anterior.then(tarea);
    this.colas.set(
      transaccion,
      actual.catch(() => undefined),
    );
    return actual;
  }
}
