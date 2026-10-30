// Historia 004 · salón y cocina, entrega 3b, ronda 2 del ataque (falla F1): los tickets a los que no les cupo todo.
//
// - `trabajo_impresion.incompleto`: `true` si el documento del trabajo termina con el aviso "Ticket incompleto: faltan
//   N líneas. Revisa la cuenta en la app." (un caso extremo que pasa de `MAXIMO_BLOQUES_TICKET` incluso en su forma más
//   densa, criterio 126). La lista de "Trabajos de hoy" lo muestra como `incompleto` para que la persona sepa que el
//   papel no trae todo. Lo escribe el sistema al encolar o reimprimir, a partir del documento; por defecto `false`
//   (los trabajos que ya existían se imprimieron completos o con el aviso viejo, que no se marca).
//
// No cambia la RLS, el trigger de trazabilidad ni los privilegios (la tabla ya concede SELECT, INSERT y UPDATE a
// `restaurante_api`). `down` quita la columna y se puede volver a migrar.
import type { ContextoMigracion } from './tipos';

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(
    'ALTER TABLE trabajo_impresion ADD COLUMN incompleto boolean NOT NULL DEFAULT false',
    { transaction },
  );
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query('ALTER TABLE trabajo_impresion DROP COLUMN incompleto', { transaction });
}
