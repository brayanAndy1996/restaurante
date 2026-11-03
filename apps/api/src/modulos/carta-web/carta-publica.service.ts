import { Injectable } from '@nestjs/common';
import type { CartaPublica, DisponibilidadPublica, EmpresaPublica } from '@restaurante/contratos';

/**
 * Lo que la carta web muestra al público (historia 005, criterios 18 a 24): arma `empresaPublica`, `cartaPublica` y
 * `disponibilidadPublica` a partir de `CartaVentaService.cartaDeSucursal` y de `SucursalesConsultaService.datosPublicos`,
 * con la lista cerrada de claves (criterio 21). No guarda nada en memoria del proceso (criterio 24).
 * FIRMAS: la implementación llega en la fase C (T9).
 */
@Injectable()
export class CartaPublicaService {
  /** `GET /publico/cartas/:empresaSlug` (criterio 18). */
  async empresa(empresaSlug: string): Promise<EmpresaPublica> {
    void empresaSlug;
    throw new Error('No implementado');
  }

  /** `GET /publico/cartas/:empresaSlug/:sucursalSlug` (criterio 19). */
  async carta(empresaSlug: string, sucursalSlug: string): Promise<CartaPublica> {
    void empresaSlug;
    void sucursalSlug;
    throw new Error('No implementado');
  }

  /** `GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad` (criterio 23). */
  async disponibilidad(empresaSlug: string, sucursalSlug: string): Promise<DisponibilidadPublica> {
    void empresaSlug;
    void sucursalSlug;
    throw new Error('No implementado');
  }
}
