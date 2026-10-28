import { Injectable } from '@nestjs/common';
import type { CartaSucursalRespuesta, LineaPreparada } from '@restaurante/contratos';
import { noImplementado } from './errores-carta';

/** Entrada de `CartaVentaService.prepararLinea` (criterio 52). */
export interface PrepararLineaEntrada {
  sucursalId: string;
  productoId: string;
  /** Ids de los modificadores elegidos, en cualquier orden. */
  modificadorIds: readonly string[];
  /** Entero de 1 a 999. */
  cantidad: number;
  /** Instante de la venta: define el día operativo (menú del día y agotados). */
  instante: Date;
}

/**
 * Contrato de la carta para el comandero (sección 3) y la carta web (sección 5). Firmas de la fase A: sin
 * lógica hasta la tarea T25. Corren dentro de un contexto de empresa (`ContextoEmpresa`).
 */
@Injectable()
export class CartaVentaService {
  /** La misma vista de `GET /carta/sucursal`, para cualquier sucursal de la empresa del contexto (criterio 51). */
  cartaDeSucursal(sucursalId: string, instante: Date): Promise<CartaSucursalRespuesta> {
    void sucursalId;
    void instante;
    return Promise.reject(noImplementado());
  }

  /**
   * Valida la selección y calcula el precio de una línea con `calcularLinea` de `packages/dominio`
   * (criterios 52 y 58). Lanza 422 `PRODUCTO_NO_VENDIBLE` o `SELECCION_INVALIDA`; un producto o un
   * modificador de otra empresa es como uno inexistente. No escribe nada.
   */
  prepararLinea(entrada: PrepararLineaEntrada): Promise<LineaPreparada> {
    void entrada;
    return Promise.reject(noImplementado());
  }
}
