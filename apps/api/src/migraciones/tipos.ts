import type { Sequelize, Transaction } from 'sequelize';

/**
 * Lo que recibe `up` y `down` de cada migración (`AAAAMMDDHHMM-descripcion.ts`): la conexión del
 * migrador y la transacción en la que corre la migración.
 */
export interface ContextoMigracion {
  sequelize: Sequelize;
  transaction: Transaction;
}
