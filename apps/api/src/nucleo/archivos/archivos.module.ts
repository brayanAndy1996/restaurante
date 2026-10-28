import { DynamicModule, Global, Module } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from './almacen-archivos';
import { crearAlmacenDeEntorno } from './crear-almacen';

/**
 * Provee `ALMACEN_ARCHIVOS` a toda la aplicación. `crearAplicacion({ almacenArchivos })` instala el de la
 * prueba; sin él se elige por `ARCHIVOS_DRIVER` (`memoria`, `disco` o `r2`; ver `crearAlmacenDeEntorno`).
 */
@Global()
@Module({})
export class ArchivosModule {
  static registrar(almacen?: AlmacenArchivos): DynamicModule {
    return {
      module: ArchivosModule,
      providers: [
        almacen
          ? { provide: ALMACEN_ARCHIVOS, useValue: almacen }
          : {
              provide: ALMACEN_ARCHIVOS,
              useFactory: (entorno: Entorno) => crearAlmacenDeEntorno(entorno),
              inject: [ENTORNO],
            },
      ],
      exports: [ALMACEN_ARCHIVOS],
    };
  }
}
