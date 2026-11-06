import { DynamicModule, Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { verificarRolDeFacturacion } from '../base-de-datos';
import { ColaEnMemoria } from './cola-en-memoria';
import { ColaPgBoss } from './cola-pg-boss';
import { COLA_PSE, type ColaPse } from './cola-pse';

/**
 * Provee `COLA_PSE` a toda la aplicación. `crearAplicacion({ colaPse })` instala la de la prueba; sin ella, con
 * `NODE_ENV=test` o sin `DATABASE_COLAS_URL` se usa la cola en memoria (que no procesa nada, criterio 137) y en los
 * demás casos la de pg-boss. Si `DATABASE_COLAS_URL` está definida, al arrancar comprueba que su rol no puede saltarse
 * la RLS (`restaurante_colas`: sin superusuario, sin `BYPASSRLS`, sin tablas de `public`, sin ser miembro del migrador;
 * criterio 163).
 */
@Global()
@Module({})
export class ColasModule implements OnModuleInit {
  constructor(@Inject(ENTORNO) private readonly entorno: Entorno) {}

  async onModuleInit(): Promise<void> {
    if (this.entorno.DATABASE_COLAS_URL === undefined) return;
    await verificarRolDeFacturacion(this.entorno.DATABASE_COLAS_URL, 'colas', 'DATABASE_COLAS_URL');
  }

  static registrar(cola?: ColaPse): DynamicModule {
    return {
      module: ColasModule,
      providers: [
        cola
          ? { provide: COLA_PSE, useValue: cola }
          : {
              provide: COLA_PSE,
              inject: [ENTORNO],
              useFactory: (entorno: Entorno): ColaPse =>
                entorno.NODE_ENV === 'test' || entorno.DATABASE_COLAS_URL === undefined
                  ? new ColaEnMemoria()
                  : new ColaPgBoss(entorno.DATABASE_COLAS_URL),
            },
      ],
      exports: [COLA_PSE],
    };
  }
}
