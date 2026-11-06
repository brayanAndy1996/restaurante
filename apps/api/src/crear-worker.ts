import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from './app.module';
import { cargarEntorno, exigirEntornoDeProduccion } from './config/entorno';
import {
  BarridoEnviosPse,
  CargaPadron,
  ProcesadorEnviosPse,
  type ConectorPse,
} from './modulos/facturacion';
import type { InventarioPuerto } from './modulos/pedidos';
import { verificarRolDeFacturacion } from './nucleo/base-de-datos';
import type { AlmacenArchivos, AlmacenComprobantes } from './nucleo/archivos';
import type { ColaPse } from './nucleo/colas';
import type { PublicadorEventos } from './nucleo/eventos';
import type { Reloj } from './nucleo/reloj';
import { noImplementado } from './nucleo/errores/no-implementado';

export interface OpcionesWorker {
  /** Conector del PSE (`CONECTOR_PSE`); por defecto un `SimuladorPse`. Las pruebas pasan uno con sus reglas. */
  pse?: ConectorPse;
  /** Cola de envíos (`COLA_PSE`); por defecto la que elige el entorno. Las pruebas pasan la misma `ColaEnMemoria`. */
  colaPse?: ColaPse;
  /** Almacén privado de comprobantes; por defecto el del entorno. */
  almacenComprobantes?: AlmacenComprobantes;
  /** Reloj; por defecto el del sistema. Las pruebas pasan el mismo `RelojManual` de la API. */
  reloj?: Reloj;
  /** Publicador de eventos de tiempo real; por defecto el nulo. En producción el worker publica con el emisor de PostgreSQL (T31). */
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
   * Empieza a trabajar: registra el procesador en la cola, arranca el barrido de 60 segundos y programa la carga diaria
   * del padrón. Con `NODE_ENV=test` las pruebas no lo llaman: corren el procesador y el barrido a mano. Fase A: lanza
   * `Error('No implementado')` hasta T31.
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
  const contexto = await NestFactory.createApplicationContext(
    AppModule.registrar({
      reloj: opciones.reloj,
      publicadorEventos: opciones.publicadorEventos,
      almacenArchivos: opciones.almacenArchivos,
      inventario: opciones.inventario,
      pse: opciones.pse,
      colaPse: opciones.colaPse,
      almacenComprobantes: opciones.almacenComprobantes,
      tiempoReal: { habilitado: false },
    }),
    {
      logger: entorno.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
      abortOnError: false,
    },
  );
  new Logger('Worker').log('Contexto del worker listo');
  return {
    contexto,
    procesador: contexto.get(ProcesadorEnviosPse),
    barrido: contexto.get(BarridoEnviosPse),
    carga: contexto.get(CargaPadron),
    iniciar: () => Promise.reject(noImplementado()),
    cerrar: () => contexto.close(),
  };
}
