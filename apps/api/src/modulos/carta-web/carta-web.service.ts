import { Inject, Injectable } from '@nestjs/common';
import type {
  CartaWebEntrada,
  CartaWebRespuesta,
  CartaWebSucursalEntrada,
  CartaWebSucursalRespuesta,
} from '@restaurante/contratos';
import { COLOR_PRINCIPAL_POR_DEFECTO } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../nucleo/archivos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import {
  cartaWebSinConfigurar,
  conflicto,
  direccionRepetida,
  noEncontrado,
} from './errores-carta-web';
import { urlDeEmpresa, urlDeSucursal } from './urls-carta-web';

/** Restricciones únicas de la migración `202611020001-carta-web`. */
const LLAVE_DEL_ESPEJO = 'empresa_slug_pk';
const UNICO_DE_SUCURSAL = 'carta_web_sucursal_slug_unico';

interface FilaCartaWeb {
  id: string;
  nombre: string;
  slug: string;
  color_principal: string;
  logo_clave: string | null;
}

interface FilaSucursalWeb {
  id: string;
  sucursal_id: string;
  slug: string;
  publicada: boolean;
}

const MENSAJE_DIRECCION_EMPRESA = 'Esa dirección ya la usa otro restaurante. Elige otra';
const MENSAJE_DIRECCION_SUCURSAL =
  'Esa dirección ya la usa otra sucursal de tu restaurante. Elige otra';

/**
 * Configuración de la carta web de la empresa y de cada sucursal (historia 005, criterios 1 a 5): dueño de
 * `carta_web` y `carta_web_sucursal`. La dirección de la empresa es única en todo el sistema: la unicidad la
 * asegura el espejo `carta_publica.empresa_slug` (un trigger lo mantiene en la misma transacción) y un choque falla
 * con `23505`, que aquí se traduce a 409 sin decir de quién es la dirección. Cada cambio deja una fila de
 * auditoría con el antes y el después; repetir lo mismo no deja ninguna. Las rutas llevan `ADMINISTRAR`.
 */
@Injectable()
export class CartaWebService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(ENTORNO) private readonly entorno: Entorno,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
  ) {}

  /** `GET /carta-web` (criterio 1). */
  async consultar(): Promise<CartaWebRespuesta> {
    const carta = await this.leerCarta(false);
    const filas = await this.conexion.query<FilaSucursalWeb>(
      'SELECT id, sucursal_id, slug, publicada FROM carta_web_sucursal',
      { type: QueryTypes.SELECT },
    );
    const porSucursal = new Map(filas.map((f) => [f.sucursal_id, f]));
    const base = this.entorno.CARTA_WEB_URL;
    const slugEmpresa = carta?.slug ?? null;
    const todas = await this.sucursales.listar(null);
    return {
      configurada: carta !== undefined,
      nombre: carta?.nombre ?? null,
      slug: slugEmpresa,
      colorPrincipal: carta?.color_principal ?? COLOR_PRINCIPAL_POR_DEFECTO,
      logoUrl: carta?.logo_clave == null ? null : this.almacen.urlPublica(carta.logo_clave),
      url: urlDeEmpresa(base, slugEmpresa),
      sucursales: todas.map((s) =>
        this.aSucursal(s.id, s.nombre, porSucursal.get(s.id), slugEmpresa),
      ),
    };
  }

  /**
   * `PUT /carta-web` (criterio 2): crea o reemplaza la configuración y deja la auditoría `configurar_carta_web`
   * con el antes y el después. Sin cambios, 200 sin fila. Una dirección de otro restaurante, 409 `CONFLICTO`.
   */
  async configurar(entrada: CartaWebEntrada): Promise<CartaWebRespuesta> {
    const despues = {
      nombre: entrada.nombre,
      slug: entrada.slug,
      colorPrincipal: entrada.colorPrincipal.toUpperCase(),
    };
    const actual = await this.leerCarta(true);
    const ahora = this.reloj.ahora();
    try {
      if (actual === undefined) {
        await this.conexion.query(
          `INSERT INTO carta_web (empresa_id, nombre, slug, color_principal, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          {
            bind: [
              this.contexto.empresaActual(),
              despues.nombre,
              despues.slug,
              despues.colorPrincipal,
              ahora,
            ],
          },
        );
        await this.auditar(null, despues, null);
        return this.consultar();
      }
      const antes = {
        nombre: actual.nombre,
        slug: actual.slug,
        colorPrincipal: actual.color_principal,
      };
      if (
        antes.nombre === despues.nombre &&
        antes.slug === despues.slug &&
        antes.colorPrincipal === despues.colorPrincipal
      ) {
        return this.consultar();
      }
      await this.conexion.query(
        `UPDATE carta_web SET nombre = $2, slug = $3, color_principal = $4, actualizado_en = $5 WHERE id = $1`,
        { bind: [actual.id, despues.nombre, despues.slug, despues.colorPrincipal, ahora] },
      );
      await this.auditar(antes, despues, actual.id);
      return this.consultar();
    } catch (error) {
      throw this.traducirUnicidad(error);
    }
  }

  /**
   * `PUT /carta-web/sucursales/:sucursalId` (criterio 4): la dirección y la publicación de una sucursal. Una
   * sucursal de otra empresa o inexistente, 404; sin la configuración de la empresa, 409 `CARTA_WEB_SIN_CONFIGURAR`;
   * una dirección repetida en la empresa, 409 `CONFLICTO`. Auditoría `configurar_carta_web_sucursal`.
   */
  async configurarSucursal(
    sucursalId: string,
    entrada: CartaWebSucursalEntrada,
  ): Promise<CartaWebSucursalRespuesta> {
    const [sucursal] = await this.sucursales.listar([sucursalId]);
    if (sucursal === undefined) throw noEncontrado('La sucursal');
    const carta = await this.leerCarta(true);
    if (carta === undefined) throw cartaWebSinConfigurar();
    const filas = await this.conexion.query<FilaSucursalWeb>(
      `SELECT id, sucursal_id, slug, publicada FROM carta_web_sucursal WHERE sucursal_id = $1 FOR UPDATE`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const actual = filas[0];
    const despues = { slug: entrada.slug, publicada: entrada.publicada };
    const ahora = this.reloj.ahora();
    let id: string;
    try {
      if (actual === undefined) {
        const creadas = await this.conexion.query<{ id: string }>(
          `INSERT INTO carta_web_sucursal (empresa_id, sucursal_id, slug, publicada, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
          {
            bind: [
              this.contexto.empresaActual(),
              sucursalId,
              despues.slug,
              despues.publicada,
              ahora,
            ],
            type: QueryTypes.SELECT,
          },
        );
        id = creadas[0]!.id;
        await this.auditarSucursal(sucursalId, id, null, despues);
      } else {
        id = actual.id;
        if (actual.slug !== despues.slug || actual.publicada !== despues.publicada) {
          await this.conexion.query(
            `UPDATE carta_web_sucursal SET slug = $2, publicada = $3, actualizado_en = $4 WHERE id = $1`,
            { bind: [actual.id, despues.slug, despues.publicada, ahora] },
          );
          await this.auditarSucursal(
            sucursalId,
            actual.id,
            { slug: actual.slug, publicada: actual.publicada },
            despues,
          );
        }
      }
    } catch (error) {
      throw this.traducirUnicidad(error);
    }
    return this.aSucursal(
      sucursalId,
      sucursal.nombre,
      { id, sucursal_id: sucursalId, ...despues },
      carta.slug,
    );
  }

  private aSucursal(
    sucursalId: string,
    nombre: string,
    fila: FilaSucursalWeb | { sucursal_id: string; slug: string; publicada: boolean } | undefined,
    slugEmpresa: string | null,
  ): CartaWebSucursalRespuesta {
    const slug = fila?.slug ?? null;
    return {
      sucursalId,
      nombre,
      slug,
      publicada: fila?.publicada ?? false,
      url: urlDeSucursal(this.entorno.CARTA_WEB_URL, slugEmpresa, slug),
    };
  }

  /** La configuración de la empresa del contexto (la RLS deja una sola fila), o `undefined` si no hay. */
  private async leerCarta(bloquear: boolean): Promise<FilaCartaWeb | undefined> {
    const filas = await this.conexion.query<FilaCartaWeb>(
      `SELECT id, nombre, slug, color_principal, logo_clave FROM carta_web${bloquear ? ' FOR UPDATE' : ''}`,
      { type: QueryTypes.SELECT },
    );
    return filas[0];
  }

  private auditar(
    antes: Record<string, string> | null,
    despues: Record<string, string>,
    id: string | null,
  ): Promise<void> {
    return this.auditoria.registrar({
      accion: 'configurar_carta_web',
      entidad: 'carta_web',
      entidadId: id,
      detalle: { antes, despues },
    });
  }

  private auditarSucursal(
    sucursalId: string,
    id: string,
    antes: { slug: string; publicada: boolean } | null,
    despues: { slug: string; publicada: boolean },
  ): Promise<void> {
    return this.auditoria.registrar({
      accion: 'configurar_carta_web_sucursal',
      sucursalId,
      entidad: 'carta_web_sucursal',
      entidadId: id,
      detalle: { sucursalId, antes, despues },
    });
  }

  /**
   * Una dirección repetida (la llave del espejo, o la de las sucursales de la empresa) es 409 sin decir de quién es.
   * Otro choque único (dos primeras configuraciones simultáneas de la misma empresa) también es 409.
   */
  private traducirUnicidad(error: unknown): unknown {
    if (sqlstateDe(error) !== SQLSTATE.VIOLACION_UNICIDAD) return error;
    const restriccion = restriccionDe(error);
    if (restriccion === LLAVE_DEL_ESPEJO) return direccionRepetida(MENSAJE_DIRECCION_EMPRESA);
    if (restriccion === UNICO_DE_SUCURSAL) return direccionRepetida(MENSAJE_DIRECCION_SUCURSAL);
    return conflicto('Otra persona cambió la carta web al mismo tiempo. Vuelve a intentarlo');
  }
}
