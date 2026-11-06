import { Logger } from '@nestjs/common';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import {
  TRABAJO_ENVIO_PSE,
  type ColaPse,
  type OpcionesDeEncolado,
  type ProcesadorDeTrabajo,
  type TrabajoEnvioPse,
} from './cola-pse';

/** Esquema de PostgreSQL de pg-boss: dueño `restaurante_colas`, lo crea `db:preparar` (criterio 163). */
export const ESQUEMA_DE_COLAS = 'colas';

/** Cuántos trabajos `envio-pse` procesa un worker a la vez (plan, «Flujo del envío», paso 3). */
export const TRABAJOS_POR_LOTE = 5;

/** Segundos que un trabajo puede estar activo antes de que pg-boss lo dé por perdido (el arriendo del envío es de 2 minutos). */
const EXPIRA_EN_SEGUNDOS = 5 * 60;
/** Cuánto se guardan los trabajos terminados: la verdad está en `envio_pse`, la cola solo despierta. */
const RETENCION_EN_SEGUNDOS = 60 * 60;
const BORRAR_DESPUES_EN_SEGUNDOS = 24 * 60 * 60;

export interface OpcionesColaPgBoss {
  /**
   * `true` en el worker: corre el mantenimiento de pg-boss (`supervise`) además de procesar. La API solo encola, así que
   * no lo corre.
   */
  mantenimiento?: boolean;
  /** Conexiones del pool de pg-boss (por defecto 4). */
  maxConexiones?: number;
}

/**
 * La cola de producción sobre pg-boss (historia 006, plan «Flujo del envío»): se conecta con el rol `restaurante_colas`
 * (`DATABASE_COLAS_URL`), dueño solo del esquema `colas`, que no ve ninguna tabla de `public`. `encolar` hace
 * `boss.send('envio-pse', datos, { singletonKey: comprobanteId, startAfter })` y `trabajar`, `boss.work('envio-pse',
 * { batchSize: 5 }, …)`. Los reintentos no los decide pg-boss (`retryLimit: 0`): los decide `envio_pse`; la cola solo
 * despierta al worker y el barrido repara lo que se pierda.
 *
 * La política de la cola es `short` con `singletonKey`: un comprobante tiene a lo más un trabajo esperando; un segundo
 * `send` mientras el primero espera no encola otro. Un trabajo activo no impide encolar el siguiente intento.
 *
 * pg-boss es un paquete ESM y la API compila a CommonJS: se carga con `import()`.
 */
export class ColaPgBoss implements ColaPse {
  private readonly logger = new Logger(ColaPgBoss.name);
  private boss: Promise<PgBoss> | null = null;
  private detenida = false;

  constructor(
    readonly url: string,
    private readonly opciones: OpcionesColaPgBoss = {},
  ) {}

  async encolar(trabajo: TrabajoEnvioPse, opciones: OpcionesDeEncolado = {}): Promise<void> {
    const boss = await this.iniciar();
    // Solo los dos ids (criterio 163): nunca datos del cliente.
    const datos: TrabajoEnvioPse = {
      empresaId: trabajo.empresaId,
      comprobanteId: trabajo.comprobanteId,
    };
    const idTrabajo = await boss.send(TRABAJO_ENVIO_PSE, datos, {
      singletonKey: trabajo.comprobanteId,
      ...(opciones.startAfter !== undefined ? { startAfter: opciones.startAfter } : {}),
    });
    // `null`: ya hay un trabajo esperando de este comprobante. Si piden «ya» (el barrido, el reintento manual), se
    // adelanta el que espera, que pudo quedar programado para más tarde.
    if (idTrabajo === null && opciones.startAfter === undefined) {
      await boss.update(TRABAJO_ENVIO_PSE, undefined, {
        singletonKey: trabajo.comprobanteId,
        startAfter: new Date(),
      });
    }
  }

  async trabajar(procesador: ProcesadorDeTrabajo): Promise<void> {
    const boss = await this.iniciar();
    await boss.work<TrabajoEnvioPse>(
      TRABAJO_ENVIO_PSE,
      { batchSize: TRABAJOS_POR_LOTE, pollingIntervalSeconds: 1 },
      async (trabajos) => {
        // Cada trabajo por separado: uno que falla no deja sin procesar a los demás del lote.
        const resultados = await Promise.allSettled(
          trabajos.map((t) =>
            procesador({ empresaId: t.data.empresaId, comprobanteId: t.data.comprobanteId }),
          ),
        );
        const fallido = resultados.find((r) => r.status === 'rejected');
        if (fallido?.status === 'rejected') {
          this.logger.warn(
            JSON.stringify({
              evento: 'pse.trabajo_fallido',
              error: fallido.reason instanceof Error ? fallido.reason.name : 'error desconocido',
            }),
          );
        }
      },
    );
  }

  async detener(): Promise<void> {
    this.detenida = true;
    const pendiente = this.boss;
    this.boss = null;
    if (pendiente === null) return;
    const boss = await pendiente.catch(() => null);
    if (boss !== null) await boss.stop({ graceful: true, timeout: 10_000 });
  }

  /** Arranca pg-boss la primera vez (crea el esquema y la cola si faltan) y reutiliza la instancia. */
  private iniciar(): Promise<PgBoss> {
    if (this.detenida) return Promise.reject(new Error('La cola de envíos está detenida'));
    this.boss ??= this.arrancar().catch((error: unknown) => {
      // Que el siguiente intento vuelva a probar en lugar de recordar el fallo para siempre.
      this.boss = null;
      throw error;
    });
    return this.boss;
  }

  private async arrancar(): Promise<PgBoss> {
    const { PgBoss: Clase } = await import('pg-boss');
    const mantenimiento = this.opciones.mantenimiento === true;
    const boss = new Clase({
      connectionString: this.url,
      schema: ESQUEMA_DE_COLAS,
      application_name: 'restaurante-colas',
      max: this.opciones.maxConexiones ?? 4,
      supervise: mantenimiento,
      schedule: mantenimiento,
      // El esquema lo crea `db:preparar` (dueño `restaurante_colas`): pg-boss solo crea sus tablas dentro de él.
      createSchema: false,
      migrate: true,
    });
    boss.on('error', (error: Error) => {
      this.logger.warn(
        JSON.stringify({ evento: 'pse.cola_error', error: error.name, mensaje: error.message }),
      );
    });
    await boss.start();
    await boss.createQueue(TRABAJO_ENVIO_PSE, {
      policy: 'short',
      retryLimit: 0,
      expireInSeconds: EXPIRA_EN_SEGUNDOS,
      retentionSeconds: RETENCION_EN_SEGUNDOS,
      deleteAfterSeconds: BORRAR_DESPUES_EN_SEGUNDOS,
    });
    return boss;
  }
}
