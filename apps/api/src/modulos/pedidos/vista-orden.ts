import { Inject, Injectable } from '@nestjs/common';
import type {
  AnulacionRespuesta,
  ComandaResumen,
  EnvioRespuesta,
  ItemRespuesta,
  MarchaRespuesta,
  OrdenRespuesta,
} from '@restaurante/contratos';
import {
  totalOrden,
  totalVigenteLinea,
  type DestinoComanda,
  type TipoComanda,
  type TipoProducto,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { CartaConsultaService } from '../carta';
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

interface FilaComanda {
  id: string;
  estacion_id: string;
  tipo: TipoComanda;
  destino: DestinoComanda;
}

const iso = (fecha: Date): string => new Date(fecha).toISOString();

const SIN_COCINA: ItemRespuesta['cocina'] = { enviado: 0, enPreparacion: 0, listo: 0, anulado: 0 };

/** Cuenta las líneas de comanda de cada ítem por estado de cocina. */
function contarCocina(conteos: readonly FilaConteo[]): Map<string, ItemRespuesta['cocina']> {
  const cocinaDe = new Map<string, ItemRespuesta['cocina']>();
  for (const c of conteos) {
    const actual = cocinaDe.get(c.item_id) ?? { ...SIN_COCINA };
    const n = Number(c.n);
    if (c.estado === 'ENVIADO') actual.enviado += n;
    else if (c.estado === 'EN_PREPARACION') actual.enPreparacion += n;
    else if (c.estado === 'LISTO') actual.listo += n;
    else actual.anulado += n;
    cocinaDe.set(c.item_id, actual);
  }
  return cocinaDe;
}

/**
 * El `itemRespuesta` de una fila. Con `comoSeEnvio`, el ítem tal como salió en su envío (nada anulado, sin
 * marchar, en estado `ENVIADO`): es lo que devuelve la réplica de un envío, siempre igual a la primera respuesta
 * aunque después se anule o se marche (criterio 26).
 */
function aItemRespuesta(
  i: FilaItem,
  cocina: ItemRespuesta['cocina'],
  nombres: ReadonlyMap<string, string>,
  comoSeEnvio: boolean,
): ItemRespuesta {
  const cantidadAnulada = comoSeEnvio ? 0 : i.cantidad_anulada;
  return {
    id: i.id,
    envioNumero: i.envio_numero,
    esAdicion: i.es_adicion,
    productoId: i.producto_id,
    nombre: i.nombre,
    tipo: i.tipo_producto,
    cantidad: i.cantidad,
    cantidadAnulada,
    cantidadVigente: i.cantidad - cantidadAnulada,
    precioUnitario: i.precio_unitario,
    totalVigente: totalVigenteLinea(i.precio_unitario, i.cantidad, cantidadAnulada),
    modificadores: i.linea.modificadores.map((m) => ({
      nombre: m.nombre,
      precioExtra: m.precioExtra,
    })),
    componentes: i.linea.componentes.map((c) => ({ nombre: c.nombre, cantidad: c.cantidad })),
    observacion: i.observacion,
    tiempo: i.tiempo,
    paraLlevar: i.para_llevar,
    marchadoEn: comoSeEnvio || i.marchado_en === null ? null : iso(i.marchado_en),
    estado: comoSeEnvio ? 'ENVIADO' : i.estado,
    cocina,
    comandadoPor:
      i.comandado_por === null
        ? null
        : { id: i.comandado_por, nombre: nombres.get(i.comandado_por) ?? '' },
    enviadoEn: iso(i.creado_en),
  };
}

const COLUMNAS_ITEM = `i.id, e.numero AS envio_numero, i.es_adicion, i.producto_id, i.nombre, i.tipo_producto,
              i.cantidad, i.cantidad_anulada, i.precio_unitario, i.linea, i.observacion, i.tiempo,
              i.para_llevar, i.marchado_en, i.estado, i.creado_por_usuario_id AS comandado_por, i.creado_en`;

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
    @Inject(CartaConsultaService) private readonly estaciones: CartaConsultaService,
  ) {}

  /**
   * `envioRespuesta` (criterio 15) del envío tal como salió: sus ítems sin lo anulado ni lo marchado después, y
   * sus comandas de envío (`COMANDA` o `ADICION`). La primera respuesta y toda réplica salen de aquí, así son
   * idénticas aunque la orden cambie después (criterio 26). 404 si el envío no es de una orden de la sucursal.
   */
  async armarEnvio(envioId: string, sucursalId: string): Promise<EnvioRespuesta> {
    const envios = await this.conexion.query<{
      id: string;
      orden_id: string;
      numero: number;
      es_adicion: boolean;
    }>(
      `SELECT e.id, e.orden_id, e.numero, e.es_adicion
         FROM envio e JOIN orden o ON o.id = e.orden_id AND o.empresa_id = e.empresa_id
        WHERE e.id = $1 AND o.sucursal_id = $2`,
      { bind: [envioId, sucursalId], type: QueryTypes.SELECT },
    );
    const envio = envios[0];
    if (envio === undefined) throw ordenNoEncontrada();

    const items = await this.conexion.query<FilaItem>(
      `SELECT ${COLUMNAS_ITEM}
         FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
        WHERE i.envio_id = $1
        ORDER BY i.posicion, i.id`,
      { bind: [envio.id], type: QueryTypes.SELECT },
    );
    // Todas las líneas del envío siguen "enviadas" en esta vista: es el envío tal como salió.
    const conteos = await this.conexion.query<FilaConteo>(
      `SELECT cl.item_id, 'ENVIADO' AS estado, count(*) AS n
         FROM comanda_linea cl JOIN comanda c ON c.id = cl.comanda_id AND c.empresa_id = cl.empresa_id
        WHERE c.envio_id = $1 AND c.tipo IN ('COMANDA', 'ADICION')
        GROUP BY cl.item_id`,
      { bind: [envio.id], type: QueryTypes.SELECT },
    );
    const comandas = await this.conexion.query<FilaComanda>(
      `SELECT id, estacion_id, tipo, destino FROM comanda
        WHERE envio_id = $1 AND tipo IN ('COMANDA', 'ADICION')`,
      { bind: [envio.id], type: QueryTypes.SELECT },
    );
    const nombres = await this.usuarios.nombres(
      items.flatMap((i) => (i.comandado_por === null ? [] : [i.comandado_por])),
    );
    const cocinaDe = contarCocina(conteos);
    return {
      id: envio.id,
      ordenId: envio.orden_id,
      numero: envio.numero,
      esAdicion: envio.es_adicion,
      items: items.map((i) =>
        aItemRespuesta(i, cocinaDe.get(i.id) ?? { ...SIN_COCINA }, nombres, true),
      ),
      comandas: await this.resumirComandas(comandas),
    };
  }

  /** `{ id, comandas }` de una marcha (criterio 32): sus comandas `MARCHAR`, siempre en el mismo orden. */
  async armarMarcha(marchaId: string): Promise<MarchaRespuesta> {
    const comandas = await this.conexion.query<FilaComanda>(
      `SELECT id, estacion_id, tipo, destino FROM comanda
        WHERE origen_id = $1 AND tipo = 'MARCHAR'`,
      { bind: [marchaId], type: QueryTypes.SELECT },
    );
    return { id: marchaId, comandas: await this.resumirComandas(comandas) };
  }

  /**
   * Las comandas como `comandaResumen`, por nombre de estación y luego por id (orden estable). `motivo` es el de
   * la anulación de la que salen las comandas `ANULACION` (criterio 38); las demás no lo llevan.
   */
  private async resumirComandas(
    comandas: readonly FilaComanda[],
    motivo: string | null = null,
  ): Promise<ComandaResumen[]> {
    const nombres = await this.estaciones.nombres(comandas.map((c) => c.estacion_id));
    return comandas
      .map((c): ComandaResumen => ({
        id: c.id,
        estacionId: c.estacion_id,
        estacionNombre: nombres.get(c.estacion_id) ?? '',
        tipo: c.tipo,
        destino: c.destino,
        motivo: c.tipo === 'ANULACION' ? motivo : null,
      }))
      .sort((a, b) => a.estacionNombre.localeCompare(b.estacionNombre) || a.id.localeCompare(b.id));
  }

  /**
   * `anulacionRespuesta` (criterio 35) de la anulación con ese id: la anulación, su ítem tal como está ahora y las
   * comandas `ANULACION` que salieron de ella (con el motivo). La primera respuesta y la réplica por el mismo id
   * salen de aquí. 404 si la anulación no es de una orden de la sucursal.
   */
  async armarAnulacion(anulacionId: string, sucursalId: string): Promise<AnulacionRespuesta> {
    const anulaciones = await this.conexion.query<{
      id: string;
      item_id: string;
      cantidad: number;
      motivo: string;
      destino_stock: AnulacionRespuesta['destinoStock'];
      autorizado_por_id: string | null;
    }>(
      `SELECT a.id, a.item_id, a.cantidad, a.motivo, a.destino_stock, a.autorizado_por_id
         FROM anulacion_item a JOIN orden o ON o.id = a.orden_id AND o.empresa_id = a.empresa_id
        WHERE a.id = $1 AND o.sucursal_id = $2`,
      { bind: [anulacionId, sucursalId], type: QueryTypes.SELECT },
    );
    const anulacion = anulaciones[0];
    if (anulacion === undefined) throw ordenNoEncontrada();

    const items = await this.conexion.query<FilaItem>(
      `SELECT ${COLUMNAS_ITEM}
         FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
        WHERE i.id = $1`,
      { bind: [anulacion.item_id], type: QueryTypes.SELECT },
    );
    const item = items[0];
    if (item === undefined) throw ordenNoEncontrada();
    const conteos = await this.conexion.query<FilaConteo>(
      `SELECT cl.item_id, cl.estado, count(*) AS n
         FROM comanda_linea cl JOIN comanda c ON c.id = cl.comanda_id AND c.empresa_id = cl.empresa_id
        WHERE cl.item_id = $1 AND c.tipo IN ('COMANDA', 'ADICION')
        GROUP BY cl.item_id, cl.estado`,
      { bind: [item.id], type: QueryTypes.SELECT },
    );
    const comandas = await this.conexion.query<FilaComanda>(
      `SELECT id, estacion_id, tipo, destino FROM comanda
        WHERE origen_id = $1 AND tipo = 'ANULACION'`,
      { bind: [anulacion.id], type: QueryTypes.SELECT },
    );
    const nombres = await this.usuarios.nombres([
      ...(item.comandado_por === null ? [] : [item.comandado_por]),
      ...(anulacion.autorizado_por_id === null ? [] : [anulacion.autorizado_por_id]),
    ]);
    const cocinaDe = contarCocina(conteos);
    return {
      id: anulacion.id,
      itemId: item.id,
      cantidad: anulacion.cantidad,
      motivo: anulacion.motivo,
      destinoStock: anulacion.destino_stock,
      autorizadoPor:
        anulacion.autorizado_por_id === null
          ? null
          : {
              id: anulacion.autorizado_por_id,
              nombre: nombres.get(anulacion.autorizado_por_id) ?? '',
            },
      item: aItemRespuesta(item, cocinaDe.get(item.id) ?? { ...SIN_COCINA }, nombres, false),
      comandas: await this.resumirComandas(comandas, anulacion.motivo),
    };
  }

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
      `SELECT ${COLUMNAS_ITEM}
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

    const cocinaDe = contarCocina(conteos);
    const itemsRespuesta = items.map((i) =>
      aItemRespuesta(i, cocinaDe.get(i.id) ?? { ...SIN_COCINA }, nombresPersonas, false),
    );

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
      precuentaVigente: await this.precuentaVigente(orden.id, orden.estado),
    };
  }

  /**
   * La pre-cuenta vigente (la que no se ha invalidado), si hay. Solo una orden `EN_PRECUENTA` puede tenerla: toda
   * escritura que cambia la orden la invalida y la devuelve a `ABIERTA` (criterios 23, 40 y 53), así que las
   * demás ni la consultan.
   */
  private async precuentaVigente(
    ordenId: string,
    estado: OrdenRespuesta['estado'],
  ): Promise<OrdenRespuesta['precuentaVigente']> {
    if (estado !== 'EN_PRECUENTA') return null;
    const filas = await this.conexion.query<{
      id: string;
      numero: number;
      total: string;
      emitida_en: Date;
    }>(
      `SELECT id, numero, total, emitida_en FROM precuenta
        WHERE orden_id = $1 AND invalidada_en IS NULL`,
      { bind: [ordenId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) return null;
    return { id: fila.id, numero: fila.numero, total: fila.total, emitidaEn: iso(fila.emitida_en) };
  }
}
