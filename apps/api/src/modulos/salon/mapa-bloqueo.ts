import { QueryTypes, type Sequelize } from 'sequelize';

/**
 * Turno para editar el mapa de una sucursal. Toda escritura de zonas y mesas lo pide primero (un cerrojo de
 * transacción con la clave de la sucursal): así crear, mover o achicar se turnan, no se cruzan en los chequeos de
 * nombre y de celda ni forman abrazos mortales entre zonas y mesas, y el que entra lee lo que dejó el anterior ya
 * confirmado. Editar el mapa es poco frecuente y corto. No bloquea a quien abre mesas: la apertura toma solo la
 * fila de la mesa.
 */
export async function tomarTurnoDelMapa(conexion: Sequelize, sucursalId: string): Promise<void> {
  await conexion.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', {
    bind: [`mapa:${sucursalId}`],
    type: QueryTypes.SELECT,
  });
}
