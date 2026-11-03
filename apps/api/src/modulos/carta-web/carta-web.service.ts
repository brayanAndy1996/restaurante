import { Injectable } from '@nestjs/common';
import type {
  CartaWebEntrada,
  CartaWebRespuesta,
  CartaWebSucursalEntrada,
  CartaWebSucursalRespuesta,
} from '@restaurante/contratos';

/**
 * Configuración de la carta web de la empresa y de cada sucursal (historia 005, criterios 1 a 5): dueño de
 * `carta_web` y `carta_web_sucursal`. FIRMAS: la implementación llega en la fase C (T5).
 */
@Injectable()
export class CartaWebService {
  /** `GET /carta-web` (criterio 1). */
  async consultar(): Promise<CartaWebRespuesta> {
    throw new Error('No implementado');
  }

  /** `PUT /carta-web` (criterio 2): crea o reemplaza la configuración y deja la auditoría `configurar_carta_web`. */
  async configurar(entrada: CartaWebEntrada): Promise<CartaWebRespuesta> {
    void entrada;
    throw new Error('No implementado');
  }

  /** `PUT /carta-web/sucursales/:sucursalId` (criterio 4): auditoría `configurar_carta_web_sucursal`. */
  async configurarSucursal(
    sucursalId: string,
    entrada: CartaWebSucursalEntrada,
  ): Promise<CartaWebSucursalRespuesta> {
    void sucursalId;
    void entrada;
    throw new Error('No implementado');
  }
}
