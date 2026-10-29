import { Inject, Injectable } from '@nestjs/common';
import type { ItemRespuesta, OrdenRespuesta } from '@restaurante/contratos';
import { totalOrden, totalVigenteLinea, type TipoProducto } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { MesasConsultaService } from '../salon';
import { UsuariosConsultaService } from '../seguridad';
import { ordenNoEncontrada } from './errores-pedidos';

interface FilaOrden {
  id: string;
  sucursal_id: string;
  tipo: OrdenRespuesta['tipo'];
  canal: OrdenRespuesta['canal'];
  estado: OrdenRespuesta['estado'];
  mozo_id: string | null;
  comensales: number;
  abierta_en: Date;
  anulada_en: Date | null;
  sin_consumo: boolean;
  unida_a_orden_id: string | null;
}

interface FilaOrdenMesa {
  mesa_id: string;
  hasta: Date | null;
}

interface FilaItem {
  id: string;
  envio_numero: number;
  es_adicion: boolean;
  producto_id: string;
  nombre: string;
  tipo_producto: TipoProducto;
  cantidad: number;
  cantidad_anulada: number;
  precio_unitario: string;
  linea: LineaGuardada;
  observacion: string | null;
  tiempo: 1 | 2;
  para_llevar: boolean;
  marchado_en: Date | null;
  estado: ItemRespuesta['estado'];
  comandado_por: string | null;
  creado_en: Date;
}

/** Lo que la vista lee de la línea preparada guardada en el ítem (`lineaPreparada`, 003, criterio 52). */
interface LineaGuardada {
  modificadores: { nombre: string; precioExtra: string }[];
  componentes: { nombre: string; cantidad: number }[];
}

interface FilaConteo {
  item_id: string;
  estado: 'ENVIADO' | 'EN_PREPARACION' | 'LISTO' | 'ANULADO';
  n: string;
}

const iso = (fecha: Date): string => new Date(fecha).toISOString();

/**
 * Arma `ordenRespuesta` (criterio 55) con una cantidad fija de consultas, sin importar cuántos ítems tenga la
 * orden: la orden, sus mesas, sus ítems (con el número de su envío), el conteo de líneas de comanda por estado y
 * los nombres de las personas y de las mesas. `total` y `totalVigente` salen de `packages/dominio`; nada se
 * suma a mano. Corre bajo la RLS de la empresa del contexto y limitada a la sucursal pedida.
 */
@Injectable()
export class VistaOrdenService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
  ) {}

  /** 404 si la orden no existe, es de otra sucursal o de otra empresa. */
  async armar(ordenId: string, sucursalId: string): Promise<OrdenRespuesta> {
    const ordenes = await this.conexion.query<FilaOrden>(
      `SELECT id, sucursal_id, tipo, canal, estado, mozo_id, comensales, abierta_en, anulada_en,
              sin_consumo, unida_a_orden_id
         FROM orden WHERE id = $1 AND sucursal_id = $2`,
      { bind: [ordenId, sucursalId], type: QueryTypes.SELECT },
    );
    const orden = ordenes[0];
    if (orden === undefined) throw ordenNoEncontrada();

    const relaciones = await this.conexion.query<FilaOrdenMesa>(
      `SELECT mesa_id, hasta FROM orden_mesa WHERE orden_id = $1 ORDER BY desde, id`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const items = await this.conexion.query<FilaItem>(
      `SELECT i.id, e.numero AS envio_numero, i.es_adicion, i.producto_id, i.nombre, i.tipo_producto,
              i.cantidad, i.cantidad_anulada, i.precio_unitario, i.linea, i.observacion, i.tiempo,
              i.para_llevar, i.marchado_en, i.estado, i.creado_por_usuario_id AS comandado_por, i.creado_en
         FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
        WHERE i.orden_id = $1
        ORDER BY e.numero, i.posicion, i.id`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    // Solo las líneas de las comandas originales: las de una marcha o una anulación repiten partes de ellas.
    const conteos = await this.conexion.query<FilaConteo>(
      `SELECT cl.item_id, cl.estado, count(*) AS n
         FROM comanda_linea cl JOIN comanda c ON c.id = cl.comanda_id AND c.empresa_id = cl.empresa_id
        WHERE cl.item_id = ANY($1::uuid[]) AND c.tipo IN ('COMANDA', 'ADICION')
        GROUP BY cl.item_id, cl.estado`,
      { bind: [items.map((i) => i.id)], type: QueryTypes.SELECT },
    );

    // Las mesas vigentes; si la orden ya no tiene (anulada, unida), las que tuvo al final.
    const vigentes = relaciones.filter((r) => r.hasta === null);
    const hastaMaximo = relaciones.reduce<number>(
      (m, r) => (r.hasta === null ? m : Math.max(m, new Date(r.hasta).getTime())),
      0,
    );
    const mesaIds = (
      vigentes.length > 0
        ? vigentes
        : relaciones.filter((r) => r.hasta !== null && new Date(r.hasta).getTime() === hastaMaximo)
    ).map((r) => r.mesa_id);
    const nombresMesas = await this.mesas.nombres(mesaIds);
    const personaIds = [
      ...(orden.mozo_id === null ? [] : [orden.mozo_id]),
      ...items.flatMap((i) => (i.comandado_por === null ? [] : [i.comandado_por])),
    ];
    const nombresPersonas = await this.usuarios.nombres(personaIds);

    const cocinaDe = new Map<string, ItemRespuesta['cocina']>();
    for (const c of conteos) {
      const actual = cocinaDe.get(c.item_id) ?? {
        enviado: 0,
        enPreparacion: 0,
        listo: 0,
        anulado: 0,
      };
      const n = Number(c.n);
      if (c.estado === 'ENVIADO') actual.enviado += n;
      else if (c.estado === 'EN_PREPARACION') actual.enPreparacion += n;
      else if (c.estado === 'LISTO') actual.listo += n;
      else actual.anulado += n;
      cocinaDe.set(c.item_id, actual);
    }

    const itemsRespuesta: ItemRespuesta[] = items.map((i) => ({
      id: i.id,
      envioNumero: i.envio_numero,
      esAdicion: i.es_adicion,
      productoId: i.producto_id,
      nombre: i.nombre,
      tipo: i.tipo_producto,
      cantidad: i.cantidad,
      cantidadAnulada: i.cantidad_anulada,
      cantidadVigente: i.cantidad - i.cantidad_anulada,
      precioUnitario: i.precio_unitario,
      totalVigente: totalVigenteLinea(i.precio_unitario, i.cantidad, i.cantidad_anulada),
      modificadores: i.linea.modificadores.map((m) => ({
        nombre: m.nombre,
        precioExtra: m.precioExtra,
      })),
      componentes: i.linea.componentes.map((c) => ({ nombre: c.nombre, cantidad: c.cantidad })),
      observacion: i.observacion,
      tiempo: i.tiempo,
      paraLlevar: i.para_llevar,
      marchadoEn: i.marchado_en === null ? null : iso(i.marchado_en),
      estado: i.estado,
      cocina: cocinaDe.get(i.id) ?? { enviado: 0, enPreparacion: 0, listo: 0, anulado: 0 },
      comandadoPor:
        i.comandado_por === null
          ? null
          : { id: i.comandado_por, nombre: nombresPersonas.get(i.comandado_por) ?? '' },
      enviadoEn: iso(i.creado_en),
    }));

    return {
      id: orden.id,
      sucursalId: orden.sucursal_id,
      tipo: orden.tipo,
      canal: orden.canal,
      estado: orden.estado,
      mesas: mesaIds.map((id) => ({ id, nombre: nombresMesas.get(id) ?? '' })),
      mozo: {
        id: orden.mozo_id ?? '',
        nombre: orden.mozo_id === null ? '' : (nombresPersonas.get(orden.mozo_id) ?? ''),
      },
      comensales: orden.comensales,
      abiertaEn: iso(orden.abierta_en),
      anuladaEn: orden.anulada_en === null ? null : iso(orden.anulada_en),
      sinConsumo: orden.sin_consumo,
      unidaA: orden.unida_a_orden_id,
      items: itemsRespuesta,
      total: totalOrden(
        items.map((i) => ({
          precioUnitario: i.precio_unitario,
          cantidad: i.cantidad,
          cantidadAnulada: i.cantidad_anulada,
        })),
      ),
      // La tabla `precuenta` llega con la migración de las anulaciones y pre-cuentas (T22): hasta entonces
      // ninguna orden tiene una pre-cuenta vigente que mostrar.
      precuentaVigente: null,
    };
  }
}
