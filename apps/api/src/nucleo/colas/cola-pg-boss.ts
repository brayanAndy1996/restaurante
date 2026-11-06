import type { ColaPse, OpcionesDeEncolado, ProcesadorDeTrabajo, TrabajoEnvioPse } from './cola-pse';

/**
 * La cola de producción sobre pg-boss (historia 006, plan "Flujo del envío"): se conecta con el rol
 * `restaurante_colas` (`DATABASE_COLAS_URL`), dueño solo del esquema `colas`. `encolar` hará
 * `boss.send('envio-pse', datos, { singletonKey: comprobanteId, startAfter, retryLimit: 0 })` y `trabajar`,
 * `boss.work('envio-pse', { batchSize: 5 }, …)`.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T31 (que agrega la dependencia `pg-boss`).
 */
export class ColaPgBoss implements ColaPse {
  constructor(readonly url: string) {}

  encolar(trabajo: TrabajoEnvioPse, opciones?: OpcionesDeEncolado): Promise<void> {
    void trabajo;
    void opciones;
    return Promise.reject(new Error('No implementado'));
  }

  trabajar(procesador: ProcesadorDeTrabajo): Promise<void> {
    void procesador;
    return Promise.reject(new Error('No implementado'));
  }

  detener(): Promise<void> {
    return Promise.reject(new Error('No implementado'));
  }
}
