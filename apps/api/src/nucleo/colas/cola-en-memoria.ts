import type { ColaPse, OpcionesDeEncolado, ProcesadorDeTrabajo, TrabajoEnvioPse } from './cola-pse';

/** Un trabajo guardado por la cola en memoria. */
export interface TrabajoPendiente extends TrabajoEnvioPse {
  /** No se procesa antes de este instante; `null` si no hay espera. */
  startAfter: Date | null;
}

/**
 * La cola de las pruebas (historia 006, criterio 137): guarda los trabajos en una lista **sin procesarlos** ni
 * deduplicarlos (el procesador es quien garantiza un solo envío por comprobante, criterio 128). Con `NODE_ENV=test`
 * `crearAplicacion` la usa y no arranca el worker: un comprobante queda `POR_ENVIAR` hasta que una prueba corre el
 * procesador. `procesarPendientes` entrega a un procesador los trabajos vencidos, uno por uno y en orden.
 */
export class ColaEnMemoria implements ColaPse {
  private readonly trabajos: TrabajoPendiente[] = [];
  private fallosPorInyectar = 0;
  private procesadorRegistrado: ProcesadorDeTrabajo | null = null;

  encolar(trabajo: TrabajoEnvioPse, opciones: OpcionesDeEncolado = {}): Promise<void> {
    if (this.fallosPorInyectar > 0) {
      this.fallosPorInyectar -= 1;
      return Promise.reject(new Error('Cola en memoria: fallo de encolado inyectado'));
    }
    this.trabajos.push({
      empresaId: trabajo.empresaId,
      comprobanteId: trabajo.comprobanteId,
      startAfter: opciones.startAfter ?? null,
    });
    return Promise.resolve();
  }

  /** Guarda el procesador (el worker); la cola en memoria nunca lo llama sola. */
  trabajar(procesador: ProcesadorDeTrabajo): Promise<void> {
    this.procesadorRegistrado = procesador;
    return Promise.resolve();
  }

  detener(): Promise<void> {
    this.procesadorRegistrado = null;
    return Promise.resolve();
  }

  /** El procesador registrado con `trabajar`, para que una prueba lo use como `procesarPendientes(cola.procesador()!)`. */
  procesador(): ProcesadorDeTrabajo | null {
    return this.procesadorRegistrado;
  }

  /** Los trabajos encolados que todavía no se procesaron, en orden de llegada (copias). */
  pendientes(): TrabajoPendiente[] {
    return this.trabajos.map((t) => ({ ...t }));
  }

  /**
   * Quita de la lista y entrega a `procesador`, en orden y uno por uno, los trabajos cuyo `startAfter` no sea posterior
   * a `ahora` (por defecto, el reloj del sistema). Devuelve cuántos entregó. Si el procesador lanza, el trabajo ya salió
   * de la lista y el error se propaga.
   */
  async procesarPendientes(
    procesador: ProcesadorDeTrabajo,
    ahora: Date = new Date(),
  ): Promise<number> {
    let entregados = 0;
    for (;;) {
      const indice = this.trabajos.findIndex(
        (t) => t.startAfter === null || t.startAfter.getTime() <= ahora.getTime(),
      );
      if (indice === -1) return entregados;
      const [trabajo] = this.trabajos.splice(indice, 1);
      if (trabajo === undefined) return entregados;
      entregados += 1;
      await procesador({ empresaId: trabajo.empresaId, comprobanteId: trabajo.comprobanteId });
    }
  }

  /** Las próximas `veces` llamadas a `encolar` fallan (para probar que el barrido recoge el envío, criterio 124). */
  fallarProximosEncolados(veces: number): void {
    this.fallosPorInyectar = veces;
  }

  /** Vacía la lista y las inyecciones de fallo. */
  vaciar(): void {
    this.trabajos.length = 0;
    this.fallosPorInyectar = 0;
  }
}
