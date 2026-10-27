import { DynamicModule, Global, Module } from '@nestjs/common';
import { RELOJ, RelojSistema, type Reloj } from './reloj';

/**
 * Provee `RELOJ` a toda la aplicación. `crearAplicacion({ reloj })` instala el de la prueba; sin
 * él, el del sistema.
 */
@Global()
@Module({})
export class RelojModule {
  static registrar(reloj?: Reloj): DynamicModule {
    return {
      module: RelojModule,
      providers: [{ provide: RELOJ, useValue: reloj ?? new RelojSistema() }],
      exports: [RELOJ],
    };
  }
}
