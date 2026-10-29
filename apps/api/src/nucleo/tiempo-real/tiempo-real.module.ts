import { DynamicModule, Global, Module } from '@nestjs/common';
import { OPCIONES_TIEMPO_REAL, type OpcionesTiempoReal } from './opciones';
import { PublicadorSocketIo } from './publicador-socket-io';
import { ServidorTiempoReal } from './servidor-tiempo-real';

/**
 * Provee `ServidorTiempoReal` y `PublicadorSocketIo` a toda la aplicación. `crearAplicacion({ tiempoReal })` fija
 * si está habilitado; sin la opción, lo decide `TIEMPO_REAL` del entorno (apagado con `NODE_ENV=test`).
 * `VALIDADOR_DE_CONEXIONES` lo provee `SeguridadModule` (global).
 */
@Global()
@Module({})
export class TiempoRealModule {
  static registrar(opciones: OpcionesTiempoReal): DynamicModule {
    return {
      module: TiempoRealModule,
      providers: [
        { provide: OPCIONES_TIEMPO_REAL, useValue: opciones },
        ServidorTiempoReal,
        PublicadorSocketIo,
      ],
      exports: [ServidorTiempoReal, PublicadorSocketIo],
    };
  }
}
