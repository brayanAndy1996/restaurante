import { NestFactory } from '@nestjs/core';
import type { INestApplication, LogLevel, Type } from '@nestjs/common';
import { AppModule } from './app.module';
import { cargarEntorno } from './config/entorno';

export interface OpcionesAplicacion {
  /**
   * Controladores adicionales registrados en el módulo raíz. Pueden inyectar `ContextoEmpresa`,
   * `OperacionPlataforma`, `PlataformaEmpresasService`, `SucursalService`, etc.
   */
  controladoresExtra?: Type[];
  /** Registro de Nest; por defecto `false` con NODE_ENV=test y el normal en los demás casos. */
  logger?: false | LogLevel[];
}

/**
 * Construye la aplicación Nest completa (filtro global de errores, interceptor global de contexto
 * de empresa y los módulos) y la deja inicializada, sin escuchar ningún puerto: lista para
 * `supertest(app.getHttpServer())`. Quien la llama debe cerrarla con `await app.close()`.
 *
 * La configuración se lee de `process.env` en cada llamada, así que se pueden crear aplicaciones
 * distintas en el mismo proceso cambiando las variables. Rechaza (con `EntornoInvalidoError`) un
 * entorno inválido, por ejemplo `EMPRESA_POR_HEADER=habilitado` con `NODE_ENV=production`.
 */
export async function crearAplicacion(
  opciones: OpcionesAplicacion = {},
): Promise<INestApplication> {
  const entorno = cargarEntorno(process.env); // falla antes de construir nada
  const app = await NestFactory.create(
    AppModule.registrar({ controladoresExtra: opciones.controladoresExtra }),
    {
      // En pruebas se silencia el registro de Nest; los errores de arranque se propagan como excepción.
      // `abortOnError: false` evita que Nest llame a process.abort() y tumbe el proceso de pruebas.
      logger: opciones.logger ?? (entorno.NODE_ENV === 'test' ? false : ['error', 'warn', 'log']),
      abortOnError: false,
    },
  );
  await app.init();
  return app;
}
