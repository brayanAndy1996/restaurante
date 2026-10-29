import type { DestinoComanda } from '@restaurante/dominio';

/**
 * Puerto de impresión del módulo de pedidos (historia 004, plan "Impresión"): el envío, la marcha, la
 * anulación y la pre-cuenta le preguntan adónde sale cada estación y le piden encolar los trabajos de
 * impresión, dentro de su transacción. En 3a todo sale por el KDS y no se encola nada (`ImpresionSoloKds`); en 3b
 * lo provee `ImpresionModule`.
 */

/** Token de Nest del puerto de impresión. */
export const IMPRESION = Symbol('IMPRESION');

/** Adónde sale la comanda de una estación en una sucursal. */
export type DestinoDeEstacion =
  | { destino: Extract<DestinoComanda, 'KDS'> }
  | { destino: Extract<DestinoComanda, 'IMPRESORA'>; impresoraId: string };

/** Un trabajo de impresión para encolar (3b). */
export interface TrabajoParaEncolar {
  sucursalId: string;
  impresoraId: string;
  tipo: 'COMANDA' | 'ADICION' | 'MARCHAR' | 'ANULACION' | 'PRECUENTA';
  comandaId: string | null;
  precuentaId: string | null;
  /** El documento lógico del ticket (`documentoTicket` de `packages/contratos` en 3b). */
  documento: Readonly<Record<string, unknown>>;
}

export interface ImpresionPuerto {
  /** El destino de cada estación pedida; una estación sin configurar sale por el `KDS`. */
  destinos(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoDeEstacion>>;
  /** Encola los trabajos en la transacción en curso. */
  encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<void>;
}

/** Puerto de 3a: toda estación sale por el KDS y no se encola nada. */
export class ImpresionSoloKds implements ImpresionPuerto {
  async destinos(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoDeEstacion>> {
    void sucursalId;
    return new Map(estacionIds.map((id) => [id, { destino: 'KDS' } as const]));
  }

  async encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<void> {
    void trabajos;
  }
}
