import type { DestinoStock, ParteDeStock } from '@restaurante/dominio';

/**
 * Punto de enganche del inventario (historia 004, decisión 2; criterios 72 y 73). El envío y las anulaciones
 * llaman a este puerto **dentro de su transacción**, con las partes de stock ya calculadas por
 * `packages/dominio`; si lanza un `ErrorAplicacion` (por ejemplo 422 `STOCK_INSUFICIENTE` en la sección 6), la
 * respuesta es ese error y nada queda guardado ni publicado. La sección 6 lo reemplaza sin tocar el envío.
 */

/** Token de Nest del puerto de inventario. */
export const INVENTARIO = Symbol('INVENTARIO');

export interface AlEnviarEntrada {
  sucursalId: string;
  envioId: string;
  /** La suma de `partesDeStockDeEnvio` de las líneas del envío. */
  partes: readonly ParteDeStock[];
}

export interface AlAnularEntrada {
  sucursalId: string;
  /** El id de la anulación del ítem; al anular una orden, el id de la orden. */
  anulacionId: string;
  /** Las partes por la cantidad anulada (`partesDeStock`). */
  partes: readonly ParteDeStock[];
  destino: DestinoStock;
}

export interface DisponiblesEntrada {
  sucursalId: string;
  productoIds: readonly string[];
}

export interface InventarioPuerto {
  /** Llamado una vez por envío, nunca en una réplica. */
  alEnviar(entrada: AlEnviarEntrada): Promise<void>;
  /** Llamado una vez por anulación de ítem o de orden. */
  alAnular(entrada: AlAnularEntrada): Promise<void>;
  /** Producto a cantidad disponible; vacío si no hay datos. */
  disponibles(entrada: DisponiblesEntrada): Promise<ReadonlyMap<string, number>>;
}

/** Puerto por defecto hasta la sección 6: no hace nada y no tiene datos de stock. */
export class InventarioNulo implements InventarioPuerto {
  async alEnviar(entrada: AlEnviarEntrada): Promise<void> {
    void entrada;
  }

  async alAnular(entrada: AlAnularEntrada): Promise<void> {
    void entrada;
  }

  async disponibles(entrada: DisponiblesEntrada): Promise<ReadonlyMap<string, number>> {
    void entrada;
    return new Map();
  }
}
