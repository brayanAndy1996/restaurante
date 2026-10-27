import { Sequelize } from 'sequelize';

export interface OpcionesConexion {
  url: string;
  /** Tamaño máximo del pool. */
  poolMax: number;
  /** Nombre que ve PostgreSQL en `pg_stat_activity`. */
  aplicacion: string;
}

/**
 * Instancia de Sequelize para PostgreSQL con las opciones comunes de la API y de plataforma. Sin
 * `useCLS` (es global a toda la clase) y sin registro de consultas.
 */
export function crearSequelize({ url, poolMax, aplicacion }: OpcionesConexion): Sequelize {
  return new Sequelize(url, {
    dialect: 'postgres',
    logging: false,
    pool: { max: poolMax, min: 0, idle: 10_000, acquire: 30_000 },
    dialectOptions: { application_name: aplicacion, connectionTimeoutMillis: 5_000 },
    define: { underscored: true },
  });
}
