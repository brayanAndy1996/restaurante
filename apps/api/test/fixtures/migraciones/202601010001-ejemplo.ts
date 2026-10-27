// Migración de ejemplo para probar el ejecutor de umzug (no forma parte de las migraciones reales).
import type { ContextoMigracion } from '../../../src/migraciones/tipos';

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query('CREATE TABLE ejemplo_migracion (id integer PRIMARY KEY)', { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query('DROP TABLE ejemplo_migracion', { transaction });
}
