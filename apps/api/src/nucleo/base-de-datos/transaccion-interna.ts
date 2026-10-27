import type { QueryOptions, Sequelize, Transaction } from 'sequelize';

/**
 * Propiedades de `Transaction` que existen en tiempo de ejecución en Sequelize 6 pero no figuran en
 * sus tipos: la instancia dueña y el estado final (`'commit'` o `'rollback'` una vez terminada).
 */
export type TransaccionInterna = Transaction & {
  readonly sequelize: Sequelize;
  readonly finished?: 'commit' | 'rollback';
};

/** Opción interna de las consultas que cierran una transacción (`COMMIT` / `ROLLBACK`). */
export type OpcionesConsultaInterna = QueryOptions & { completesTransaction?: boolean };
