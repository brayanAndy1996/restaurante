import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../nucleo/archivos';
import { CONEXION_API } from '../../nucleo/base-de-datos';

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
 * `carta_web_sucursal` y nadie más las consulta. Corre en la transacción de la empresa del contexto activo, así que
 * la RLS limita todo a la propia empresa; la empresa de una dirección se busca antes y fuera del contexto con
 * `buscarEmpresaDeCarta`.
 */
@Injectable()
export class CartaWebConsultaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
  ) {}

  /** La configuración de la carta web de la empresa del contexto si su dirección es `slug`; si no, `null`. */
  async resolverEmpresa(slug: string): Promise<CartaWebDeEmpresa | null> {
    const filas = await this.conexion.query<{
      nombre: string;
      slug: string;
      color_principal: string;
      logo_clave: string | null;
    }>('SELECT nombre, slug, color_principal, logo_clave FROM carta_web WHERE slug = $1', {
      bind: [slug],
      type: QueryTypes.SELECT,
    });
    const f = filas[0];
    if (f === undefined) return null;
    return {
      nombre: f.nombre,
      slug: f.slug,
      colorPrincipal: f.color_principal,
      logoUrl: f.logo_clave === null ? null : this.almacen.urlPublica(f.logo_clave),
    };
  }

  /** La configuración de la carta web de la empresa del contexto (hay una sola), o `null` si no la configuró. */
  async deLaEmpresa(): Promise<CartaWebDeEmpresa | null> {
    const filas = await this.conexion.query<{
      nombre: string;
      slug: string;
      color_principal: string;
      logo_clave: string | null;
    }>('SELECT nombre, slug, color_principal, logo_clave FROM carta_web LIMIT 1', {
      type: QueryTypes.SELECT,
    });
    const f = filas[0];
    if (f === undefined) return null;
    return {
      nombre: f.nombre,
      slug: f.slug,
      colorPrincipal: f.color_principal,
      logoUrl: f.logo_clave === null ? null : this.almacen.urlPublica(f.logo_clave),
    };
  }

  /** Si la carta de la sucursal está publicada, su dirección; si no (o si no hay configuración), `null`. */
  async sucursalPublicada(sucursalId: string): Promise<SucursalPublicada | null> {
    const filas = await this.conexion.query<{ sucursal_id: string; slug: string }>(
      `SELECT s.sucursal_id, s.slug FROM carta_web_sucursal s
        WHERE s.sucursal_id = $1 AND s.publicada
          AND EXISTS (SELECT 1 FROM carta_web w WHERE w.empresa_id = s.empresa_id)`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return filas[0] === undefined
      ? null
      : { sucursalId: filas[0].sucursal_id, slug: filas[0].slug };
  }

  /** La sucursal publicada de la empresa del contexto con esa dirección, o `null`. */
  async sucursalPorSlug(slug: string): Promise<SucursalPublicada | null> {
    const filas = await this.conexion.query<{ sucursal_id: string; slug: string }>(
      `SELECT s.sucursal_id, s.slug FROM carta_web_sucursal s
        WHERE s.slug = $1 AND s.publicada
          AND EXISTS (SELECT 1 FROM carta_web w WHERE w.empresa_id = s.empresa_id)`,
      { bind: [slug], type: QueryTypes.SELECT },
    );
    return filas[0] === undefined
      ? null
      : { sucursalId: filas[0].sucursal_id, slug: filas[0].slug };
  }

  /** Las sucursales de la empresa del contexto con la carta publicada, con su dirección. */
  async sucursalesPublicadas(): Promise<SucursalPublicada[]> {
    const filas = await this.conexion.query<{ sucursal_id: string; slug: string }>(
      `SELECT s.sucursal_id, s.slug FROM carta_web_sucursal s
        WHERE s.publicada
          AND EXISTS (SELECT 1 FROM carta_web w WHERE w.empresa_id = s.empresa_id)
        ORDER BY s.slug, s.sucursal_id`,
      { type: QueryTypes.SELECT },
    );
    return filas.map((f) => ({ sucursalId: f.sucursal_id, slug: f.slug }));
  }
}
