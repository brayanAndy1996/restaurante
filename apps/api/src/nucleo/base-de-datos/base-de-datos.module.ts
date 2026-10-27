import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Sequelize } from 'sequelize';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { crearSequelize } from './crear-sequelize';
import { instalarGuardaApi } from './guarda-api';
import { CONEXION_API } from './token-api';
import { verificarRolDeConexion } from './verificar-roles';

/**
 * Conexión de la API (`restaurante_api`). Instala la guarda de consultas, verifica al arrancar que el
 * rol no pueda saltarse la RLS (criterio 10) y cierra el pool al apagar. La conexión de plataforma
 * la provee `PlataformaModule`, no este módulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONEXION_API,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno): Sequelize => {
        const sequelize = crearSequelize({
          url: entorno.DATABASE_URL,
          poolMax: entorno.DB_POOL_MAX,
          aplicacion: 'restaurante-api',
        });
        instalarGuardaApi(sequelize);
        return sequelize;
      },
    },
  ],
  exports: [CONEXION_API],
})
export class BaseDeDatosModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BaseDeDatosModule.name);

  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  async onModuleInit(): Promise<void> {
    try {
      await verificarRolDeConexion(this.conexion, 'DATABASE_URL');
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.conexion.close();
  }
}
