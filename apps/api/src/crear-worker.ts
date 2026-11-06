import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from './app.module';
import { cargarEntorno, exigirEntornoDeProduccion } from './config/entorno';
import {
  BarridoEnviosPse,
  CargaPadron,
  ProcesadorEnviosPse,
  TrabajoEnSegundoPlano,
  type ConectorPse,
} from './modulos/facturacion';
import type { InventarioPuerto } from './modulos/pedidos';
import { verificarRolDeFacturacion } from './nucleo/base-de-datos';
import type { AlmacenArchivos, AlmacenComprobantes } from './nucleo/archivos';
import type { ColaPse } from './nucleo/colas';
import type { PublicadorEventos } from './nucleo/eventos';
import type { Reloj } from './nucleo/reloj';
import { EmisorDelWorker } from './nucleo/tiempo-real';

export interface OpcionesWorker {
  /** Conector del PSE (`CONECTOR_PSE`); por defecto un `SimuladorPse`. Las pruebas pasan uno con sus reglas. */
  pse?: ConectorPse;
  /** Cola de envíos (`COLA_PSE`); por defecto la que elige el entorno. Las pruebas pasan la misma `ColaEnMemoria`. */
  colaPse?: ColaPse;
  /** Almacén privado de comprobantes; por defecto el del entorno. */
  almacenComprobantes?: AlmacenComprobantes;
  /** Reloj; por defecto el del sistema. Las pruebas pasan el mismo `RelojManual` de la API. */
  reloj?: Reloj;
  /**
   * Publicador de eventos de tiempo real; por defecto el emisor de PostgreSQL (`DATABASE_TIEMPO_REAL_URL`, rol
   * `restaurante_tiempo_real`) si está definida y, si no, el nulo. Las pruebas pasan el mismo `PublicadorEnMemoria`.
   */
  publicadorEventos?: PublicadorEventos;
  almacenArchivos?: AlmacenArchivos;
  inventario?: InventarioPuerto;
}

/**
 * El worker de envíos al PSE (historia 006, entrega 6b, criterio 125): un contexto de Nest con los mismos módulos que la
 * API pero sin servidor HTTP ni Socket.IO. Expone lo que corre en segundo plano: el procesador de envíos, el barrido y la
 * carga del padrón.
 */
export interface WorkerEnvios {
  contexto: INestApplicationContext;
  procesador: ProcesadorEnviosPse;
  barrido: BarridoEnviosPse;
  carga: CargaPadron;
  /**
   * Empieza a trabajar: registra el procesador en la cola y arranca el barrido de 60 segundos (la carga diaria del
   * padrón la programa T36). Con `NODE_ENV=test` las pruebas de la historia no lo llaman: corren el procesador y el
   * barrido a mano (criterio 137).
   */
  iniciar(): Promise<void>;
  /** Detiene el barrido y la cola, y cierra el contexto (los pools incluidos). */
  cerrar(): Promise<void>;
}

/**
 * Arma el worker con los mismos módulos que `crearAplicacion`, sin HTTP. Comprueba el entorno como la API y, si
 * `DATABASE_REFERENCIA_URL` está definida, que su rol (`restaurante_referencia`) no pueda saltarse la RLS (el de la cola
 * lo comprueba el módulo de colas al arrancar). Quien lo crea debe cerrarlo con `await worker.cerrar()`.
 */
export async function crearWorker(opciones: OpcionesWorker = {}): Promise<WorkerEnvios> {
  const entorno = cargarEntorno(process.env);
  exigirEntornoDeProduccion(entorno);
  if (entorno.DATABASE_REFERENCIA_URL !== undefined) {
    await verificarRolDeFacturacion(
      entorno.DATABASE_REFERENCIA_URL,
      'referencia',
      'DATABASE_REFERENCIA_URL',
    );
  }
  // El worker no sirve Socket.IO: sus eventos salen por el canal de PostgreSQL (criterio 172).
  let emisor: EmisorDelWorker | null = null;
  let publicadorEventos = opciones.publicadorEventos;
  if (publicadorEventos === undefined && entorno.DATABASE_TIEMPO_REAL_URL !== undefined) {
    emisor = new EmisorDelWorker(entorno.DATABASE_TIEMPO_REAL_URL);
    try {
      await emisor.verificar();
    } catch (error) {
      await emisor.cerrar();
      throw error;
    }
    publicadorEventos = emisor;
  }
  const contexto = await NestFactory.createApplicationContext(
    AppModule.registrar({
      reloj: opciones.reloj,
      publicadorEventos,
      almacenArchivos: opciones.almacenArchivos,
      inventario: opciones.inventario,
      pse: opciones.pse,
      colaPse: opciones.colaPse,
      almacenComprobantes: opciones.almacenComprobantes,
      tiempoReal: { habilitado: false },
      // El worker no arranca solo (`iniciar()`), pero su cola sí corre el mantenimiento de pg-boss.
      worker: { autoIniciar: false, mantenimientoDeCola: true },
    }),
    {
      logger: entorno.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
      abortOnError: false,
    },
  ).catch(async (error: unknown) => {
    await emisor?.cerrar();
    throw error;
  });
  new Logger('Worker').log('Contexto del worker listo');
  const trabajo = contexto.get(TrabajoEnSegundoPlano);
  return {
    contexto,
    procesador: contexto.get(ProcesadorEnviosPse),
    barrido: contexto.get(BarridoEnviosPse),
    carga: contexto.get(CargaPadron),
    iniciar: () => trabajo.iniciar(),
    cerrar: async () => {
      await trabajo.detener();
      await contexto.close();
      await emisor?.cerrar();
    },
  };
}
