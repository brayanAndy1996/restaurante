import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

/**
 * Sesiones de soporte del superadministrador dentro de una empresa (criterio 66). Son funciones que
 * reciben la transacción de `OperacionPlataforma` (la política `acceso_plataforma` de `sesion` deja
 * escribirlas sin contexto de empresa). `sesion` es una de las tablas sin trazabilidad.
 */

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

/** Inactividad de una sesión de soporte, en minutos. */
export const MINUTOS_INACTIVIDAD_SOPORTE = 30;
/** Duración máxima de una sesión de soporte, en horas. */
export const HORAS_MAXIMAS_SOPORTE = 2;

export interface DatosSesionSoporte {
  id: string;
  empresaId: string;
  superadministradorId: string;
  sucursalId: string | null;
  huellaSecreto: Buffer;
  ahora: Date;
}

/** Inserta la sesión `SOPORTE` (30 minutos de inactividad y 2 horas como máximo). */
export async function insertarSesionSoporte(
  transaccion: Transaction,
  datos: DatosSesionSoporte,
): Promise<void> {
  const expira = new Date(datos.ahora.getTime() + HORAS_MAXIMAS_SOPORTE * 3_600_000);
  await sequelizeDe(transaccion).query(
    `INSERT INTO sesion (id, empresa_id, tipo, superadministrador_id, sucursal_id, huella_secreto,
                         ultima_actividad_en, expira_en, minutos_inactividad, creado_en, actualizado_en)
     VALUES ($1, $2, 'SOPORTE', $3, $4, $5, $6, $7, $8, $6, $6)`,
    {
      transaction: transaccion,
      bind: [
        datos.id,
        datos.empresaId,
        datos.superadministradorId,
        datos.sucursalId,
        datos.huellaSecreto,
        datos.ahora,
        expira,
        MINUTOS_INACTIVIDAD_SOPORTE,
      ],
    },
  );
}

/**
 * Cierra todas las sesiones de soporte abiertas de un superadministrador, en cualquier empresa (al
 * desactivarlo, criterios 61 y 62). Devuelve cuántas cerró.
 */
export async function cerrarSesionesDeSuperadministrador(
  transaccion: Transaction,
  superadministradorId: string,
  ahora: Date,
): Promise<number> {
  const cerradas = await sequelizeDe(transaccion).query<{ id: string }>(
    `UPDATE sesion SET cerrada_en = $2, motivo_cierre = 'SUPERADMINISTRADOR_DESACTIVADO', actualizado_en = $2
      WHERE superadministrador_id = $1 AND cerrada_en IS NULL
      RETURNING id`,
    { transaction: transaccion, bind: [superadministradorId, ahora], type: QueryTypes.SELECT },
  );
  return cerradas.length;
}
