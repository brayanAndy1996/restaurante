import { Injectable } from '@nestjs/common';

/**
 * Dado un conjunto de órdenes, devuelve de cada una la orden en la que quedó (la misma, o la principal a la que se
 * unió, siguiendo la cadena de uniones).
 */
export type ResolutorDeOrdenes = (
  ordenIds: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/**
 * Dada una orden, ella y todas las que terminaron unidas a ella (siguiendo la cadena de uniones al revés): los
 * trabajos de la cuenta que ve el mozo.
 */
export type BuscadorDeAbsorbidas = (ordenId: string) => Promise<readonly string[]>;

/**
 * Punto de enganche entre la lista de trabajos de impresión y las órdenes (historia 004, 3b, criterio 128): el
 * trabajo guarda la orden de origen de su comanda, que no cambia al unir mesas, pero la cuenta que ve el mozo es la
 * principal. `impresion` no puede consultar las tablas de pedidos ni importar su módulo (pedidos ya importa
 * este), así que `PedidosModule` registra al arrancar cómo resolverlas, como `UsoDeMesas` en el salón. Sin
 * resolutor, cada orden se queda como está (solo es para mostrar).
 */
@Injectable()
export class OrdenesVigentes {
  private resolutor: ResolutorDeOrdenes | null = null;
  private buscador: BuscadorDeAbsorbidas | null = null;

  registrar(resolutor: ResolutorDeOrdenes, absorbidas?: BuscadorDeAbsorbidas): void {
    this.resolutor = resolutor;
    this.buscador = absorbidas ?? null;
  }

  /** La orden y las que se le unieron (una sola, ella misma, si no hay quien lo sepa): para filtrar por cuenta. */
  async delaCuenta(ordenId: string): Promise<string[]> {
    const ids = this.buscador === null ? [] : await this.buscador(ordenId);
    return [...new Set([ordenId, ...ids])];
  }

  /** La orden vigente de cada una de las pedidas (las que no se unieron, ellas mismas). */
  async resolver(ordenIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(ordenIds)];
    if (ids.length === 0) return new Map();
    const resueltas =
      this.resolutor === null ? new Map<string, string>() : await this.resolutor(ids);
    return new Map(ids.map((id) => [id, resueltas.get(id) ?? id]));
  }
}
