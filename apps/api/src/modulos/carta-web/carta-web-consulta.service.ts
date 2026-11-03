import { Injectable } from '@nestjs/common';

/** La marca y la dirección de la carta web de una empresa, vistas dentro del contexto de esa empresa. */
export interface CartaWebDeEmpresa {
  nombre: string;
  slug: string;
  colorPrincipal: string;
  logoUrl: string | null;
}

/** Una sucursal con la carta web publicada. */
export interface SucursalPublicada {
  sucursalId: string;
  /** La dirección de la sucursal. */
  slug: string;
}

/**
 * Lecturas de la carta web para otros módulos (historia 005): `carta-web` es dueño de `carta_web` y
 * `carta_web_sucursal` y nadie más las consulta. Corre en la transacción de la empresa del contexto activo; la
 * empresa de una dirección se busca antes y fuera del contexto con `buscarEmpresaDeCarta`.
 * FIRMAS: la implementación llega en la fase C (T5 y T9).
 */
@Injectable()
export class CartaWebConsultaService {
  /** La configuración de la carta web de la empresa del contexto si su dirección es `slug`; si no, `null`. */
  async resolverEmpresa(slug: string): Promise<CartaWebDeEmpresa | null> {
    void slug;
    throw new Error('No implementado');
  }

  /** Si la carta de la sucursal está publicada, su dirección; si no (o si no hay configuración), `null`. */
  async sucursalPublicada(sucursalId: string): Promise<SucursalPublicada | null> {
    void sucursalId;
    throw new Error('No implementado');
  }

  /** La sucursal publicada de la empresa del contexto con esa dirección, o `null`. */
  async sucursalPorSlug(slug: string): Promise<SucursalPublicada | null> {
    void slug;
    throw new Error('No implementado');
  }
}
