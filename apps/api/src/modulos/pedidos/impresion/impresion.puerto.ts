import type { DocumentoTicket, TipoTrabajo } from '@restaurante/contratos';
import type { DestinoComanda } from '@restaurante/dominio';

/**
 * Puerto de impresión del módulo de pedidos (historia 004, plan "Impresión"): el envío, la marcha, la
 * anulación y la pre-cuenta le preguntan adónde sale cada estación y le piden encolar los trabajos de
 * impresión, dentro de su transacción. Lo provee `ImpresionModule` (en 3a, antes de la impresión, todo salía por
 * el KDS y no se encolaba nada).
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
  tipo: TipoTrabajo;
  /** La comanda de la que sale el trabajo (índice único: una comanda, un trabajo); `null` en la pre-cuenta. */
  comandaId: string | null;
  /** La pre-cuenta de la que sale el trabajo; `null` en una comanda. */
  precuentaId: string | null;
  /**
   * Los nombres de las mesas de la cuenta separados por coma, para la lista de trabajos (criterio 128). `encolar` lo
   * recorta con "…" a los 300 caracteres que admite la columna.
   */
  mesa: string | null;
  /** La orden de la comanda o de la pre-cuenta (de origen: no cambia al unir mesas). */
  ordenId: string | null;
  /** El número del envío de una `COMANDA` o `ADICION`; `null` en los demás trabajos. */
  envioNumero: number | null;
  /**
   * Historia 006 (criterios 90 y 95): el comprobante de un trabajo `COMPROBANTE` y el turno de un `REPORTE_X`,
   * `REPORTE_Z` o `GAVETA` (migración 7 de 006; el tipo y la columna deben coincidir). Opcionales: los demás trabajos
   * no los llevan.
   */
  comprobanteId?: string | null;
  turnoId?: string | null;
  /**
   * El trabajo del que es reimpresión (historia 006, criterio 90): la reimpresión de un comprobante lleva el id del
   * trabajo de su emisión. Nunca abre la gaveta ni entra en los únicos de la emisión (criterios 94 y 95).
   */
  reimpresionDeId?: string | null;
  documento: DocumentoTicket;
}

/** Adónde sale una estación, con el nombre de la impresora (la pantalla del KDS lo muestra, criterio 138). */
export type DestinoVisibleDeEstacion =
  | { destino: Extract<DestinoComanda, 'KDS'> }
  | {
      destino: Extract<DestinoComanda, 'IMPRESORA'>;
      impresora: { id: string; nombre: string };
    };

/** Una impresora tal como la ve caja: para elegirla como impresora de una caja y para mostrarla. */
export interface ImpresoraDeCajaVisible {
  id: string;
  nombre: string;
  gaveta: boolean;
  activa: boolean;
}

export interface ImpresionPuerto {
  /** El destino de cada estación pedida; una estación sin configurar sale por el `KDS`. */
  destinos(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoDeEstacion>>;
  /**
   * Lo mismo que `destinos`, para mostrarlo: con el id y el nombre de la impresora de las estaciones que salen por
   * impresora. Una consulta, sin importar cuántas estaciones se pidan.
   */
  destinosVisibles(
    sucursalId: string,
    estacionIds: readonly string[],
  ): Promise<ReadonlyMap<string, DestinoVisibleDeEstacion>>;
  /**
   * Encola los trabajos en la transacción en curso, en el orden dado, y devuelve el id de cada uno en el mismo
   * orden. Después de confirmar avisa (`trabajo.nuevo`) al puente de la sucursal si tiene uno vinculado.
   */
  encolar(trabajos: readonly TrabajoParaEncolar[]): Promise<string[]>;
  /** La impresora de caja de la sucursal (activa), donde salen las pre-cuentas (criterio 102); `null` si no hay. */
  impresoraDeCaja(sucursalId: string): Promise<{ id: string } | null>;
  /**
   * La impresora de un trabajo de caja (historia 006, criterios 2 y 90): `impresoraId` (la propia de la caja, que
   * caja leyó de `caja.impresora_id`; impresión no lee `caja`) si es una impresora activa de la sucursal o, si es
   * `null` o ya no está activa, la de caja de la sucursal (`impresoraDeCaja`). Devuelve `gaveta` para saber si el
   * ticket lleva el pulso; `null` si tampoco hay (el cobro se hace igual, sin imprimir).
   */
  impresoraDeLaCaja(
    sucursalId: string,
    impresoraId: string | null,
  ): Promise<{ id: string; gaveta: boolean } | null>;
  /**
   * De las impresoras dadas, las que son de la sucursal, con su nombre, si tienen gaveta y si están activas (historia
   * 006, criterios 1 y 2): caja valida con esto la `impresoraId` de una caja y muestra su impresora sin leer
   * `impresora`. Las de otra sucursal, de otra empresa o inexistentes no aparecen.
   */
  impresorasDeLaSucursal(
    sucursalId: string,
    impresoraIds: readonly string[],
  ): Promise<ReadonlyMap<string, ImpresoraDeCajaVisible>>;
  /**
   * De las pre-cuentas dadas, el id del trabajo `PRECUENTA` de las que lo tienen (criterio 102): devolver la
   * vigente o una réplica no crea otro trabajo, devuelve este.
   */
  trabajosDePrecuentas(precuentaIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /**
   * El trabajo `COMPROBANTE` de la emisión de un comprobante con su documento (criterio 90): facturación lo copia, con
   * la marca de reimpresión, para reimprimir el ticket tal como salió. `null` si el comprobante se emitió sin
   * impresora.
   */
  trabajoDeComprobante(
    comprobanteId: string,
  ): Promise<{ id: string; documento: DocumentoTicket } | null>;
}
