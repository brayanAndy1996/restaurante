import { Inject, Injectable } from '@nestjs/common';
import {
  cartaPublicaSchema,
  disponibilidadPublicaSchema,
  empresaPublicaSchema,
  type CartaPublica,
  type DisponibilidadPublica,
  type EmpresaPublica,
  type ProductoDeVenta,
  type ProductoPublico,
} from '@restaurante/contratos';
import { dentroDeHorario, type TramoHorario } from '@restaurante/dominio';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CartaVentaService } from '../carta';
import { SucursalesConsultaService, SuscripcionService } from '../plataforma';
import { CartaWebConsultaService, type CartaWebDeEmpresa } from './carta-web-consulta.service';
import { ContextoPublico, direccionNormalizada } from './contexto-publico';
import { cartaNoDisponible } from './errores-carta-web';
import {
  MODULO_DE_PEDIDOS_WEB,
  soloLoQueSePuedePedir,
  type FamiliaDeVenta,
} from './filtro-publico';

/** Lo que se arma una vez por petición: la marca, la sucursal y su carta de venta con el reloj de la API. */
interface CartaArmada {
  config: CartaWebDeEmpresa;
  sucursal: {
    id: string;
    slug: string;
    nombre: string;
    direccion: string;
    horario: TramoHorario[];
  };
  familias: FamiliaDeVenta[];
  ahora: Date;
}

/**
 * Lo que la carta web muestra al público (historia 005, criterios 18 a 24): arma `empresaPublica`, `cartaPublica` y
 * `disponibilidadPublica` a partir de `CartaVentaService.cartaDeSucursal` y de `SucursalesConsultaService.datosPublicos`,
 * con la lista cerrada de claves (criterio 21): la respuesta pasa por el esquema estricto de `packages/contratos`, así
 * que una clave de más es un error del servidor y nunca una fuga. No guarda nada en memoria del proceso (criterio
 * 24): cada petición lee la base, así que un agotado o una reactivación se ven en la siguiente. Se arma con un número
 * fijo de consultas, sin importar cuántos productos haya (criterio 22).
 */
@Injectable()
export class CartaPublicaService {
  constructor(
    @Inject(ContextoPublico) private readonly publico: ContextoPublico,
    @Inject(CartaWebConsultaService) private readonly consulta: CartaWebConsultaService,
    @Inject(CartaVentaService) private readonly ventas: CartaVentaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** `GET /publico/cartas/:empresaSlug` (criterio 18). */
  async empresa(empresaSlug: string): Promise<EmpresaPublica> {
    return this.publico.porDireccion(empresaSlug, async () => {
      const config = await this.consulta.resolverEmpresa(direccionNormalizada(empresaSlug)!);
      if (config === null) throw cartaNoDisponible();
      const publicadas = await this.consulta.sucursalesPublicadas();
      const ids = publicadas.map((s) => s.sucursalId);
      const modulos = await this.suscripciones.modulosDeSucursales(ids);
      const conPedidosWeb = publicadas.filter((s) =>
        (modulos.get(s.sucursalId) ?? []).includes(MODULO_DE_PEDIDOS_WEB),
      );
      if (conPedidosWeb.length === 0) throw cartaNoDisponible();
      const datos = await this.sucursales.datosPublicos(conPedidosWeb.map((s) => s.sucursalId));
      const lista = conPedidosWeb.flatMap((s) => {
        const d = datos.get(s.sucursalId);
        return d === undefined ? [] : [{ nombre: d.nombre, slug: s.slug, direccion: d.direccion }];
      });
      lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.slug.localeCompare(b.slug));
      return empresaPublicaSchema.parse({
        empresa: marcaDe(config),
        sucursales: lista,
      });
    });
  }

  /** `GET /publico/cartas/:empresaSlug/:sucursalSlug` (criterio 19). */
  async carta(empresaSlug: string, sucursalSlug: string): Promise<CartaPublica> {
    exigirDireccion(sucursalSlug);
    return this.publico.porDireccion(empresaSlug, async () => {
      const { config, sucursal, familias, ahora } = await this.armar(empresaSlug, sucursalSlug);
      const visibles = soloLoQueSePuedePedir(familias);
      return cartaPublicaSchema.parse({
        empresa: marcaDe(config),
        sucursal: {
          nombre: sucursal.nombre,
          slug: sucursal.slug,
          direccion: sucursal.direccion,
          horario: sucursal.horario.map((t) => ({ dia: t.dia, desde: t.desde, hasta: t.hasta })),
          abiertaAhora:
            sucursal.horario.length === 0 ? null : dentroDeHorario(sucursal.horario, ahora),
        },
        familias: visibles.map((f) => ({
          id: f.id,
          nombre: f.nombre,
          productos: f.productos.map(aProductoPublico),
        })),
      });
    });
  }

  /** `GET /publico/cartas/:empresaSlug/:sucursalSlug/disponibilidad` (criterio 23). */
  async disponibilidad(empresaSlug: string, sucursalSlug: string): Promise<DisponibilidadPublica> {
    exigirDireccion(sucursalSlug);
    return this.publico.porDireccion(empresaSlug, async () => {
      const { familias } = await this.armar(empresaSlug, sucursalSlug);
      return disponibilidadPublicaSchema.parse({
        vendibles: soloLoQueSePuedePedir(familias).flatMap((f) =>
          f.productos.map((p) => ({
            id: p.id,
            modificadoresNoDisponibles: p.grupos.flatMap((g) =>
              g.modificadores.filter((m) => !m.disponible).map((m) => m.id),
            ),
          })),
        ),
      });
    });
  }

  /**
   * Dentro del contexto de la empresa: la marca, la sucursal publicada con esa dirección y con `PEDIDOS_WEB` en su
   * plan (si no, el mismo 404 de siempre) y su carta de venta con el reloj de la API (criterio 19).
   */
  private async armar(empresaSlug: string, sucursalSlug: string): Promise<CartaArmada> {
    const slugSucursal = direccionNormalizada(sucursalSlug);
    if (slugSucursal === null) throw cartaNoDisponible();
    const config = await this.consulta.resolverEmpresa(direccionNormalizada(empresaSlug)!);
    if (config === null) throw cartaNoDisponible();
    const publicada = await this.consulta.sucursalPorSlug(slugSucursal);
    if (publicada === null) throw cartaNoDisponible();
    const modulos = await this.suscripciones.modulosDeSucursal(publicada.sucursalId);
    if (!modulos.includes(MODULO_DE_PEDIDOS_WEB)) throw cartaNoDisponible();
    const ahora = this.reloj.ahora();
    const vista = await this.ventas.cartaDeSucursal(publicada.sucursalId, ahora);
    const datos = (await this.sucursales.datosPublicos([publicada.sucursalId])).get(
      publicada.sucursalId,
    );
    if (datos === undefined) throw cartaNoDisponible();
    return {
      config,
      sucursal: {
        id: publicada.sucursalId,
        slug: publicada.slug,
        nombre: datos.nombre,
        direccion: datos.direccion,
        horario: datos.horario,
      },
      familias: vista.familias,
      ahora,
    };
  }
}

/** La dirección de la sucursal debe tener forma de dirección: si no, 404 sin consultar nada (criterio 14). */
function exigirDireccion(sucursalSlug: string): void {
  if (direccionNormalizada(sucursalSlug) === null) throw cartaNoDisponible();
}

const marcaDe = (config: CartaWebDeEmpresa) => ({
  nombre: config.nombre,
  logoUrl: config.logoUrl,
  colorPrincipal: config.colorPrincipal,
});

/** Un producto de la carta de venta reducido a lo que ve el cliente (criterios 19 y 21). */
function aProductoPublico(p: ProductoDeVenta): ProductoPublico {
  return {
    id: p.id,
    tipo: p.tipo,
    nombre: p.nombre,
    descripcion: p.descripcion,
    fotoUrl: p.fotoUrl,
    precio: p.precio!,
    grupos: p.grupos.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      seleccion: g.seleccion,
      minimo: g.minimo,
      maximo: g.maximo,
      obligatorio: g.obligatorio,
      modificadores: g.modificadores
        .filter((m) => m.disponible)
        .map((m) => ({ id: m.id, nombre: m.nombre, precioExtra: m.precioExtra })),
    })),
    componentes: p.componentes.map((c) => ({ nombre: c.nombre, cantidad: c.cantidad })),
  };
}
