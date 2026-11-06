import { DynamicModule, Global, Module } from '@nestjs/common';
import { ALMACEN_COMPROBANTES, type AlmacenComprobantes } from './almacen-comprobantes';
import { AlmacenComprobantesEnMemoria } from './almacen-comprobantes-en-memoria';

/**
 * Provee `ALMACEN_COMPROBANTES` a toda la aplicación. `crearAplicacion({ almacenComprobantes })` instala el de la
 * prueba. Fase A: sin él, el de memoria en todos los entornos; el de disco (desarrollo) y el de R2 privado
 * (producción, `R2_BUCKET_COMPROBANTES`) llegan con T31.
 */
@Global()
@Module({})
export class AlmacenComprobantesModule {
  static registrar(almacen?: AlmacenComprobantes): DynamicModule {
    return {
      module: AlmacenComprobantesModule,
      providers: [
        {
          provide: ALMACEN_COMPROBANTES,
          useValue: almacen ?? new AlmacenComprobantesEnMemoria(),
        },
      ],
      exports: [ALMACEN_COMPROBANTES],
    };
  }
}
