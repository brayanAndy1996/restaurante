import { DynamicModule, Global, Module } from '@nestjs/common';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from './almacen-archivos';
import { AlmacenEnMemoria } from './almacen-en-memoria';

/**
 * Provee `ALMACEN_ARCHIVOS` a toda la aplicación. `crearAplicacion({ almacenArchivos })` instala el de la
 * prueba. Sin él, y mientras no existan `AlmacenEnDisco` ni `AlmacenR2` (tarea T10, que elegirá por
 * `ARCHIVOS_DRIVER`), se usa `AlmacenEnMemoria`.
 */
@Global()
@Module({})
export class ArchivosModule {
  static registrar(almacen?: AlmacenArchivos): DynamicModule {
    return {
      module: ArchivosModule,
      providers: [{ provide: ALMACEN_ARCHIVOS, useValue: almacen ?? new AlmacenEnMemoria() }],
      exports: [ALMACEN_ARCHIVOS],
    };
  }
}
