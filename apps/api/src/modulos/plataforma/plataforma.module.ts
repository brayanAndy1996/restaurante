import {
  Inject,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  Logger,
} from '@nestjs/common';
import type { Sequelize } from 'sequelize';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { CONEXION_API, verificarRolDeConexion } from '../../nucleo/base-de-datos';
import {
  CONEXION_PLATAFORMA,
  ConexionPlataforma,
  crearConexionPlataforma,
} from '../../nucleo/base-de-datos/conexion-plataforma';
import { MODELOS_API, MODELOS_PLATAFORMA, definirModelos } from './modelos';
import { EmisoresController } from './emisores.controller';
import { OperacionPlataforma } from './operacion-plataforma';
import { PlanesController } from './planes.controller';
import { PlataformaEmpresasController } from './plataforma-empresas.controller';
import { PlataformaEmpresasService } from './plataforma-empresas.service';
import { PlataformaSesionesController } from './plataforma-sesiones.controller';
import { SucursalService } from './sucursal.service';
import { SucursalesController } from './sucursales.controller';
import { SuperadministradorGuard } from './superadministrador.guard';
import { SuscripcionService } from './suscripcion.service';
import { SuscripcionesController } from './suscripciones.controller';

/**
 * Dueño de las tablas de plataforma (empresa, emisor, sucursal, auditoría). Provee la conexión de
 * plataforma (`CONEXION_PLATAFORMA`, no exportada) y los dos juegos de modelos: los de la API (bajo
 * RLS, solo dentro de `ContextoEmpresa`) y los de plataforma (solo dentro de `OperacionPlataforma`).
 */
@Module({
  controllers: [
    SucursalesController,
    EmisoresController,
    PlataformaSesionesController,
    PlataformaEmpresasController,
    PlanesController,
    SuscripcionesController,
  ],
  providers: [
    {
      provide: CONEXION_PLATAFORMA,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno): ConexionPlataforma =>
        crearConexionPlataforma(entorno.DATABASE_PLATAFORMA_URL),
    },
    {
      provide: MODELOS_PLATAFORMA,
      inject: [CONEXION_PLATAFORMA],
      useFactory: (conexion: ConexionPlataforma) =>
        definirModelos(conexion.sequelize, { conAuditoria: true }),
    },
    {
      provide: MODELOS_API,
      inject: [CONEXION_API],
      useFactory: (sequelize: Sequelize) => definirModelos(sequelize, { conAuditoria: false }),
    },
    OperacionPlataforma,
    PlataformaEmpresasService,
    SucursalService,
    SuscripcionService,
    SuperadministradorGuard,
  ],
  exports: [
    OperacionPlataforma,
    PlataformaEmpresasService,
    SucursalService,
    SuscripcionService,
    SuperadministradorGuard,
  ],
})
export class PlataformaModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PlataformaModule.name);

  constructor(@Inject(CONEXION_PLATAFORMA) private readonly conexion: ConexionPlataforma) {}

  async onModuleInit(): Promise<void> {
    try {
      await verificarRolDeConexion(this.conexion.sequelize, 'DATABASE_PLATAFORMA_URL');
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.conexion.cerrar();
  }
}
