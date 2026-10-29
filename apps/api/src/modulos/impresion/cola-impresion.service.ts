import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import type { DestinoDeEstacion, ImpresionPuerto, TrabajoParaEncolar } from '../pedidos/impresion';

/**
 * El puerto `IMPRESION` de 3b (historia 004, criterios 99 a 102 y 114; plan "Impresión"): pedidos le pregunta
 * adónde sale cada estación y le pide encolar los trabajos, dentro de su transacción. Lo provee `ImpresionModule`.
 *
 * Firma de la fase A (T35), para que 3a siga en verde: toda estación sale por el `KDS` (todavía no hay
 * destinos configurables) y `encolar` lanza "No implementado" solo si recibe algún trabajo, es decir, solo si
 * algún destino fuera `IMPRESORA`. T37 lee `estacion_destino` y T40 inserta en `trabajo_impresion`.
 */
@Injectable()
export class ColaImpresionService implements ImpresionPuerto {
  async destinos(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoDeEstacion>> {
    void sucursalId;
    return new Map(estacionIds.map((id) => [id, { destino: 'KDS' } as const]));
  }

  async encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<void> {
    if (trabajos.length > 0) throw noImplementado();
  }
}
