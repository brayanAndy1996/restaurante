import { DynamicModule, Global, Module } from '@nestjs/common';
import { PUBLICADOR_EVENTOS, type PublicadorEventos } from './publicador-eventos';
import { PublicadorNulo } from './publicador-nulo';

/**
 * Provee `PUBLICADOR_EVENTOS` a toda la aplicación. `crearAplicacion({ publicadorEventos })` instala el de
 * la prueba; sin él, el `PublicadorNulo`.
 */
@Global()
@Module({})
export class EventosModule {
  static registrar(publicador?: PublicadorEventos): DynamicModule {
    return {
      module: EventosModule,
      providers: [{ provide: PUBLICADOR_EVENTOS, useValue: publicador ?? new PublicadorNulo() }],
      exports: [PUBLICADOR_EVENTOS],
    };
  }
}
