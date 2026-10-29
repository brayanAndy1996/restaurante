import { DynamicModule, Global, Module, type Provider, type Type } from '@nestjs/common';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from './publicador-eventos';
import { PublicadorNulo } from './publicador-nulo';

/**
 * Provee `PUBLICADOR_EVENTOS` a toda la aplicación. `crearAplicacion({ publicadorEventos })` instala el de
 * la prueba; sin él, el `alternativa` que pase quien arma la aplicación (el `PublicadorSocketIo` cuando el tiempo
 * real está habilitado, que otro módulo provee) y, si tampoco hay, el `PublicadorNulo`.
 */
@Global()
@Module({})
export class EventosModule {
  static registrar(
    publicador?: PublicadorEventos,
    alternativa?: Type<PublicadorEventos>,
  ): DynamicModule {
    const proveedor: Provider =
      publicador !== undefined
        ? { provide: PUBLICADOR_EVENTOS, useValue: publicador }
        : alternativa !== undefined
          ? { provide: PUBLICADOR_EVENTOS, useExisting: alternativa }
          : { provide: PUBLICADOR_EVENTOS, useValue: new PublicadorNulo() };
    return {
      module: EventosModule,
      providers: [proveedor],
      exports: [PUBLICADOR_EVENTOS],
    };
  }
}
