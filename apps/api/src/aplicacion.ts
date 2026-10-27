import { NestFactory } from '@nestjs/core';
import type { INestApplication, LogLevel, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { cargarEntorno, exigirEntornoDeProduccion } from './config/entorno';
import type { Reloj } from './nucleo/reloj';
import { LIMITE_CUERPO_BYTES, traducirErrorDeCuerpo } from './nucleo/errores/filtro-global-errores';

export interface OpcionesAplicacion {
  /**
   * Controladores adicionales registrados en el módulo raíz. Pueden inyectar `ContextoEmpresa`,
   * `OperacionPlataforma`, `PlataformaEmpresasService`, `SucursalService`, etc.
   */
  controladoresExtra?: Type[];
  /** Registro de Nest; por defecto `false` con NODE_ENV=test y el normal en los demás casos. */
  logger?: false | LogLevel[];
  /**
   * Reloj de la API (`RELOJ`) del que toda regla de tiempo toma la hora; por defecto el del sistema.
   * Las pruebas pasan un `RelojManual` y lo mueven con `fijar` y `avanzar`.
   */
  reloj?: Reloj;
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
  exigirEntornoDeProduccion(entorno); // en producción exige PIN_PEPPER y ORIGENES_PERMITIDOS
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.registrar({ controladoresExtra: opciones.controladoresExtra, reloj: opciones.reloj }),
    {
      // En pruebas se silencia el registro de Nest; los errores de arranque se propagan como excepción.
      // `abortOnError: false` evita que Nest llame a process.abort() y tumbe el proceso de pruebas.
      logger: opciones.logger ?? (entorno.NODE_ENV === 'test' ? false : ['error', 'warn', 'log']),
      abortOnError: false,
      // Los analizadores de cuerpo se registran abajo con el límite explícito (criterio 40b).
      bodyParser: false,
    },
  );
  // CORS solo para los orígenes de la PWA (`ORIGENES_PERMITIDOS`), sin cookies: la autenticación va en
  // `Authorization` y en `X-Equipo` (historia 002). Con la lista vacía (solo en pruebas) no se permite
  // ningún origen de navegador.
  app.enableCors({
    origin: entorno.ORIGENES_PERMITIDOS,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Equipo',
      'X-Actividad',
      'X-Autorizacion',
      'Idempotency-Key',
    ],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  });
  // Un cuerpo mayor a 100 KB responde 413 CUERPO_DEMASIADO_GRANDE (lo traduce el filtro global).
  app.useBodyParser('json', { limit: LIMITE_CUERPO_BYTES });
  app.useBodyParser('urlencoded', { limit: LIMITE_CUERPO_BYTES, extended: true });
  // Un JSON mal formado responde 400 DATOS_INVALIDOS con un mensaje fijo, no el del analizador (40c).
  app.use(
    (error: unknown, _peticion: unknown, _respuesta: unknown, siguiente: (e?: unknown) => void) =>
      siguiente(traducirErrorDeCuerpo(error)),
  );
  try {
    await app.init();
  } catch (error) {
    // Arranque rechazado (por ejemplo, un rol privilegiado): se cierran los pools que ya se crearon.
    await app.close().catch(() => undefined);
    throw error;
  }
  return app;
}
