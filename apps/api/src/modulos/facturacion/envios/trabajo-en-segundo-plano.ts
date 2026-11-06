import {
  DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { COLA_PSE, type ColaPse } from '../../../nucleo/colas';
import { BarridoEnviosPse } from './barrido-envios';
import { ProcesadorEnviosPse } from './procesador-envios';

/** Token de las opciones del trabajo en segundo plano (`AppModule.registrar({ worker })`). */
export const OPCIONES_WORKER = Symbol('OPCIONES_WORKER');

export interface OpcionesWorker {
  /**
   * `true` si este proceso trabaja al arrancar (`WORKER=habilitado` dentro de la API): registra el procesador en la cola y
   * arranca el barrido. El worker como proceso aparte (`crearWorker`) llama a `iniciar()` él mismo.
   */
  autoIniciar: boolean;
  /** `true` si pg-boss corre aquí su mantenimiento (vencimientos y limpieza): el worker, no una API que solo encola. */
  mantenimientoDeCola: boolean;
}

/** Provee `OPCIONES_WORKER` a toda la aplicación. Sin ellas el proceso no trabaja solo (la API de las pruebas). */
@Global()
@Module({})
export class OpcionesWorkerModule {
  static registrar(opciones: OpcionesWorker): DynamicModule {
    return {
      module: OpcionesWorkerModule,
      providers: [{ provide: OPCIONES_WORKER, useValue: opciones }],
      exports: [OPCIONES_WORKER],
    };
  }
}

/**
 * Lo que corre en segundo plano en el worker de envíos (historia 006, criterio 125): registra el procesador en la cola
 * (`boss.work('envio-pse', …)`) y arranca el barrido de 60 segundos. Lo arranca `crearWorker(...).iniciar()` o, con
 * `WORKER=habilitado`, la propia API al iniciar; con `NODE_ENV=test` nada de esto ocurre solo (criterio 137): las pruebas
 * llaman al procesador y al barrido a mano. Al cerrar la aplicación se detiene todo.
 */
@Injectable()
export class TrabajoEnSegundoPlano implements OnApplicationBootstrap, OnApplicationShutdown {
  private iniciado = false;

  constructor(
    @Inject(ProcesadorEnviosPse) private readonly procesador: ProcesadorEnviosPse,
    @Inject(BarridoEnviosPse) private readonly barrido: BarridoEnviosPse,
    @Inject(COLA_PSE) private readonly cola: ColaPse,
    @Optional() @Inject(OPCIONES_WORKER) private readonly opciones: OpcionesWorker | null = null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.opciones?.autoIniciar === true) await this.iniciar();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.detener();
  }

  /** Empieza a trabajar: el procesador en la cola y el barrido. Repetirlo no hace nada. */
  async iniciar(): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;
    try {
      await this.cola.trabajar((trabajo) =>
        this.procesador.procesar(trabajo.empresaId, trabajo.comprobanteId),
      );
    } catch (error) {
      this.iniciado = false;
      throw error;
    }
    this.barrido.iniciar();
  }

  /** Detiene el barrido y la cola (espera la vuelta y los trabajos en curso). */
  async detener(): Promise<void> {
    if (!this.iniciado) return;
    this.iniciado = false;
    await this.barrido.detener();
    await this.cola.detener();
  }
}
