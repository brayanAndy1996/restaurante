import type { DocumentoTicket } from '@restaurante/contratos';
import type { DestinoComanda, TipoComanda } from '@restaurante/dominio';

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

/**
 * Un trabajo de impresión para encolar (3b, criterios 101 y 114). El documento lógico (`documentoTicket` de
 * `packages/contratos`) lo arma pedidos con las plantillas de `impresion`; los bytes se arman al entregar el trabajo
 * al puente, con la configuración vigente de la impresora (criterio 126).
 */
export interface TrabajoParaEncolar {
  sucursalId: string;
  impresoraId: string;
  /** La estación de la comanda; `null` en la pre-cuenta. */
  estacionId: string | null;
  tipo: TipoComanda | 'PRECUENTA' | 'PRUEBA';
  /** La comanda de la que sale el trabajo (índice único: una comanda, un trabajo); `null` en la pre-cuenta. */
  comandaId: string | null;
  /** La pre-cuenta de la que sale el trabajo; `null` en una comanda. */
  precuentaId: string | null;
  /** Los nombres de las mesas de la cuenta separados por coma, para la lista de trabajos (criterio 128). */
  mesa: string | null;
  /** La orden de la comanda o de la pre-cuenta (de origen: no cambia al unir mesas). */
  ordenId: string | null;
  /** El número del envío de una `COMANDA` o `ADICION`; `null` en los demás trabajos. */
  envioNumero: number | null;
  documento: DocumentoTicket;
}

export interface ImpresionPuerto {
  /** El destino de cada estación pedida; una estación sin configurar sale por el `KDS`. */
  destinos(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoDeEstacion>>;
  /**
   * Encola los trabajos en la transacción en curso, en el orden dado, y devuelve el id de cada uno en el mismo
   * orden. Después de confirmar avisa (`trabajo.nuevo`) al puente de la sucursal si tiene uno vinculado.
   */
  encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<string[]>;
  /** La impresora de caja de la sucursal (activa), donde salen las pre-cuentas (criterio 102); `null` si no hay. */
  impresoraDeCaja(sucursalId: string): Promise<{ id: string } | null>;
  /**
   * De las pre-cuentas dadas, el id del trabajo `PRECUENTA` de las que lo tienen (criterio 102): devolver la
   * vigente o una réplica no crea otro trabajo, devuelve este.
   */
  trabajosDePrecuentas(precuentaIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
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

  async encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<string[]> {
    void trabajos;
    return [];
  }

  async impresoraDeCaja(sucursalId: string): Promise<{ id: string } | null> {
    void sucursalId;
    return null;
  }

  async trabajosDePrecuentas(
    precuentaIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    void precuentaIds;
    return new Map();
  }
}
