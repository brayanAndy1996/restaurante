// Historia 005 · ataque de la ronda 1 (F6): quién atendió y quién cerró un llamado también se distingue por su
// **sesión**. Una sesión de soporte no tiene usuario ni equipo (las columnas de persona y de equipo quedan nulas), así
// que sin la sesión dos sesiones de soporte distintas parecerían "la misma persona" (criterio 43) y la segunda
// recibiría 200 en lugar de 409 `LLAMADO_TOMADO`. Solo se compara en soporte; para una persona vale su usuario, desde
// cualquier sesión o equipo.
//
// Son llaves compuestas con la empresa hacia `sesion`, como `autorizacion.sesion_id` (002). Las migraciones están
// exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE llamado
  ADD COLUMN atendido_por_sesion_id uuid,
  ADD COLUMN cerrado_por_sesion_id uuid,
  ADD CONSTRAINT llamado_atendido_sesion_fk
    FOREIGN KEY (atendido_por_sesion_id, empresa_id) REFERENCES sesion (id, empresa_id),
  ADD CONSTRAINT llamado_cerrado_sesion_fk
    FOREIGN KEY (cerrado_por_sesion_id, empresa_id) REFERENCES sesion (id, empresa_id);
`;

const SQL_DOWN = `
ALTER TABLE llamado
  DROP CONSTRAINT llamado_atendido_sesion_fk,
  DROP CONSTRAINT llamado_cerrado_sesion_fk,
  DROP COLUMN atendido_por_sesion_id,
  DROP COLUMN cerrado_por_sesion_id;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
