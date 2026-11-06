import { DynamicModule, Global, Module } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { ALMACEN_COMPROBANTES, type AlmacenComprobantes } from './almacen-comprobantes';
import { crearAlmacenDeComprobantesDeEntorno } from './crear-almacen-comprobantes';

/**
 * Provee `ALMACEN_COMPROBANTES` a toda la aplicación. `crearAplicacion({ almacenComprobantes })` instala el de la
 * prueba; sin él, el que elige `ARCHIVOS_DRIVER` (memoria, disco en desarrollo o el bucket privado de R2).
 */
@Global()
@Module({})
export class AlmacenComprobantesModule {
  static registrar(almacen?: AlmacenComprobantes): DynamicModule {
    return {
      module: AlmacenComprobantesModule,
      providers: [
        almacen
          ? { provide: ALMACEN_COMPROBANTES, useValue: almacen }
          : {
              provide: ALMACEN_COMPROBANTES,
              inject: [ENTORNO],
              useFactory: (entorno: Entorno): AlmacenComprobantes =>
                crearAlmacenDeComprobantesDeEntorno(entorno),
            },
      ],
      exports: [ALMACEN_COMPROBANTES],
    };
  }
}
