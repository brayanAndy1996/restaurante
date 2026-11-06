import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../../nucleo/errores/no-implementado';

/**
 * Nombre del actor de las transacciones del worker de envíos (historia 006, criterios 125 y 163); lo registran las
 * columnas de trazabilidad de `envio_pse`, `intento_pse` y los cambios de estado de `comprobante` (criterio 171).
 */
export const ACTOR_WORKER_ENVIO_PSE = 'worker:envio-pse';

/**
 * El procesador de un envío al PSE (historia 006, entrega 6b, criterios 125 a 131; ruta crítica P7), en tres pasos:
 * tomar (transacción corta con `FOR UPDATE SKIP LOCKED` y arriendo), llamar (sin transacción: `emitir`, o `consultar`
 * y solo con `NO_EXISTE` `emitir`) y guardar (transacción corta, solo si el arriendo sigue siendo suyo).
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T31.
 */
@Injectable()
export class ProcesadorEnviosPse {
  /**
   * Procesa el envío del comprobante con el contexto de `empresaId` (`ContextoEmpresa.ejecutar` en cada transacción, con
   * el actor `worker:envio-pse`). Un envío que no existe, de otra empresa, `TERMINADO`, `DETENIDO`, que no toca todavía o
   * con un arriendo vigente termina sin hacer nada. No lanza por un resultado del PSE.
   */
  procesar(empresaId: string, comprobanteId: string): Promise<void> {
    void empresaId;
    void comprobanteId;
    return Promise.reject(noImplementado());
  }
}
