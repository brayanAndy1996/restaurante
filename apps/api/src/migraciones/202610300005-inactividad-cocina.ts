// Historia 004 · salón y cocina, grupo C1 (criterios 63b y 63c, decisión 11): inactividad aparte para las
// sesiones de Cocina/Barra.
//
// - `sucursal_acceso.minutos_inactividad_cocina`: minutos sin uso que aguanta una sesión de PIN o de contraseña
//   cuyo rol en la sucursal activa es Cocina/Barra. De 1 a 720, por defecto 60; las filas que ya existen quedan
//   con 60. Sin fila en la sucursal, la API usa también 60.
// - La tabla es de la historia 002 (módulo de seguridad): aquí solo se agrega la columna. Ni su RLS, ni sus
//   privilegios, ni el trigger de trazabilidad cambian. `sesion.minutos_inactividad` no cambia: el tiempo de
//   Cocina/Barra se decide al validar la sesión, así un cambio de rol, de sucursal o de configuración rige desde
//   la siguiente petición.
//
// Aunque su número sea el último de 3a, es la primera migración que se aplica en la fase C (decisión del
// orquestador, 2026-10-29). `down` borra la columna.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE sucursal_acceso
  ADD COLUMN minutos_inactividad_cocina smallint NOT NULL DEFAULT 60
    CONSTRAINT sucursal_acceso_minutos_inactividad_cocina_ck
      CHECK (minutos_inactividad_cocina BETWEEN 1 AND 720);
`;

const SQL_DOWN = `
ALTER TABLE sucursal_acceso DROP COLUMN minutos_inactividad_cocina;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
