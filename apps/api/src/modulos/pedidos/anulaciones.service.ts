import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  AnulacionRespuesta,
  AnularItemEntrada,
  AnularOrdenEntrada,
  LineaPreparada,
  OrdenRespuesta,
} from '@restaurante/contratos';
import {
  partesDeComanda,
  partesDeStock,
  partesDeStockDeEnvio,
  totalOrden,
  totalVigenteLinea,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { MesasConsultaService } from '../salon';
import { SesionActual } from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import { guardarComandas, type ComandaGuardada, type ParteParaGuardar } from './comandas';
import {
  cantidadMayorQueLaVigente,
  idDeClienteReutilizado,
  itemNoAnulable,
  itemNoEncontrado,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { IMPRESION, type ImpresionPuerto } from './impresion';
import { INVENTARIO, type InventarioPuerto } from './inventario';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { invalidarPrecuentaVigente } from './precuenta-invalidacion';
import { huellaDeAnulacion, huellaDeAnulacionDeOrden } from './replica';
import { VistaOrdenService } from './vista-orden';

/** Un ítem tal como lo necesita una anulación. */
interface ItemAnulable {
  id: string;
  producto_id: string;
  nombre: string;
  cantidad: number;
  cantidad_anulada: number;
  precio_unitario: string;
  linea: LineaPreparada;
  observacion: string | null;
  tiempo: 1 | 2;
  para_llevar: boolean;
}

interface FilaReplica {
  item_id: string;
  de_orden: boolean;
  huella_entrada: Buffer;
}

/** Un ítem con la cantidad que se le anula. */
interface Anulado {
  item: ItemAnulable;
  cantidad: number;
}

const COLUMNAS_ITEM = `i.id, i.producto_id, i.nombre, i.cantidad, i.cantidad_anulada, i.precio_unitario,
       i.linea, i.observacion, i.tiempo, i.para_llevar`;

/**
 * Anular un ítem enviado y anular la orden (historia 004, criterios 34 a 43; ruta crítica P3). Todo corre en la
 * transacción de la petición, con la empresa y el actor de la sesión; la sucursal es siempre la activa. La clave
 * del supervisor ya la consumió `ClaveDiferidaInterceptor` en esa misma transacción (guardada en
 * `SesionActual.autorizacionConsumida()`): si la anulación falla, el consumo se revierte con ella.
 *
 * Orden de las comprobaciones de una anulación de ítem (plan, "Anular un ítem"): la orden se bloquea (`FOR UPDATE`;
 * serializa las anulaciones con los envíos, las marchas y las pre-cuentas de la misma orden); el ítem de esa orden
 * (404); la réplica por el id de la anulación (antes del estado, así llega aunque la orden se anule después); el
 * estado de la orden (409), el ítem (409) y la cantidad (422); los `INSERT` y los `UPDATE`; el puerto de
 * inventario (dentro de la transacción: si lanza, no queda nada); y los eventos, que salen solo al confirmar.
 */
@Injectable()
export class AnulacionesService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(INVENTARIO) private readonly inventario: InventarioPuerto,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
    @Inject(VistaOrdenService) private readonly vista: VistaOrdenService,
  ) {}

  // -------------------------------------------------------------------------------------------------
  // Anular un ítem (criterios 35 a 41)
  // -------------------------------------------------------------------------------------------------

  async anularItem(
    ordenId: string,
    itemId: string,
    entrada: AnularItemEntrada,
  ): Promise<AnulacionRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const anulacionId = entrada.id.toLowerCase();

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
    const items = await this.conexion.query<ItemAnulable>(
      `SELECT ${COLUMNAS_ITEM} FROM item i WHERE i.id = $1 AND i.orden_id = $2 FOR UPDATE`,
      { bind: [itemId, orden.id], type: QueryTypes.SELECT },
    );
    const item = items[0];
    if (item === undefined) throw itemNoEncontrado();

    // Réplica por el id de la anulación (criterio 37): antes del estado de la orden y de la cantidad.
    const huella = huellaDeAnulacion({
      itemId: item.id,
      cantidad: entrada.cantidad,
      destinoStock: entrada.destinoStock,
    });
    const previas = await this.conexion.query<FilaReplica>(
      'SELECT item_id, de_orden, huella_entrada FROM anulacion_item WHERE id = $1',
      { bind: [anulacionId], type: QueryTypes.SELECT },
    );
    const previa = previas[0];
    if (previa !== undefined) {
      if (previa.item_id !== item.id || previa.de_orden || !previa.huella_entrada.equals(huella)) {
        throw idDeClienteReutilizado();
      }
      return this.vista.armarAnulacion(anulacionId, sucursalId);
    }

    exigirOrdenAbierta(orden);
    const vigente = item.cantidad - item.cantidad_anulada;
    if (vigente === 0) throw itemNoAnulable();
    if (entrada.cantidad > vigente) throw cantidadMayorQueLaVigente(vigente);

    const ahora = this.reloj.ahora();
    const autorizacion = this.sesion.autorizacionConsumida();
    const insertada = await this.conexion.query<{ id: string }>(
      `INSERT INTO anulacion_item (id, empresa_id, item_id, orden_id, cantidad, motivo, destino_stock,
                                   autorizado_por_id, autorizacion_id, de_orden, huella_entrada, creado_en,
                                   actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $11)
       ON CONFLICT (empresa_id, id) DO NOTHING
       RETURNING id`,
      {
        bind: [
          anulacionId,
          empresaId,
          item.id,
          orden.id,
          entrada.cantidad,
          entrada.motivo,
          entrada.destinoStock,
          autorizacion?.autorizadorId ?? null,
          autorizacion?.autorizacionId ?? null,
          huella,
          ahora,
        ],
        type: QueryTypes.SELECT,
      },
    );
    // El mismo id lo guardó otra petición de otra orden mientras esta esperaba: no es una réplica.
    if (insertada.length === 0) throw idDeClienteReutilizado();

    // La cantidad anulada sube; con la vigente en 0 el ítem pasa a ANULADO (criterio 35).
    await this.conexion.query(
      `UPDATE item
          SET cantidad_anulada = cantidad_anulada + $2::int,
              estado = CASE WHEN cantidad_anulada + $2::int = cantidad THEN 'ANULADO' ELSE estado END,
              actualizado_en = $3
        WHERE id = $1`,
      { bind: [item.id, entrada.cantidad, ahora], type: QueryTypes.UPDATE },
    );
    if (vigente === entrada.cantidad) await this.anularLineasDeCocina([item.id], ahora);

    // Una comanda ANULACION por estación, con la cantidad anulada de cada parte (criterio 38).
    const comandas = await this.guardarComandasDeAnulacion({
      empresaId,
      sucursalId,
      ordenId: orden.id,
      origenId: anulacionId,
      ahora,
      anulados: [{ item, cantidad: entrada.cantidad }],
    });

    // El inventario, dentro de la transacción y una sola vez (criterio 39): si lanza, se revierte todo.
    await this.inventario.alAnular({
      sucursalId,
      anulacionId,
      partes: partesDeStock(item.linea, entrada.cantidad),
      destino: entrada.destinoStock,
    });

    const estabaEnPrecuenta = await this.cambiarLaOrden(orden.id, orden.estado, ahora);

    await this.auditoria.registrar({
      accion: 'anular_item',
      entidad: 'item',
      entidadId: item.id,
      motivo: entrada.motivo,
      autorizadoPorId: autorizacion?.autorizadorId ?? null,
      autorizacionId: autorizacion?.autorizacionId ?? null,
      detalle: {
        ordenId: orden.id,
        productoId: item.producto_id,
        nombre: item.nombre,
        cantidadAnulada: entrada.cantidad,
        vigenteAntes: vigente,
        vigenteDespues: vigente - entrada.cantidad,
        precioUnitario: item.precio_unitario,
        totalAnulado: totalVigenteLinea(item.precio_unitario, entrada.cantidad, 0),
        destinoStock: entrada.destinoStock,
      },
    });

    // Eventos: solo después de confirmar (criterio 38).
    this.publicarComandas(sucursalId, comandas);
    this.eventos.ordenCambio(sucursalId, orden.id);
    if (estabaEnPrecuenta) {
      this.eventos.salonCambio(
        sucursalId,
        orden.id,
        await mesasVigentesDeOrden(this.conexion, orden.id),
      );
    }
    return this.vista.armarAnulacion(anulacionId, sucursalId);
  }

  // -------------------------------------------------------------------------------------------------
  // Anular la orden (criterios 42 y 43)
  // -------------------------------------------------------------------------------------------------

  /**
   * Anula una orden abierta: cada ítem con cantidad vigente se anula por esa cantidad con el mismo motivo y destino
   * (una fila de `anulacion_item` por ítem, marcada `de_orden`), se crean las comandas `ANULACION` por estación,
   * se llama una vez al inventario con todas las partes, la orden queda `ANULADA` y sus mesas libres. Deja una sola
   * fila de auditoría `anular_orden` (ninguna `anular_item`). La réplica de la misma `Idempotency-Key` la devuelve
   * el interceptor de idempotencia; con otra clave, una orden ya anulada responde 409.
   */
  async anularOrden(ordenId: string, entrada: AnularOrdenEntrada): Promise<OrdenRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
    exigirOrdenAbierta(orden);

    const vigentes = await this.conexion.query<ItemAnulable>(
      `SELECT ${COLUMNAS_ITEM}
         FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
        WHERE i.orden_id = $1 AND i.cantidad > i.cantidad_anulada
        ORDER BY e.numero, i.posicion, i.id
          FOR UPDATE OF i`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const anulados: Anulado[] = vigentes.map((item) => ({
      item,
      cantidad: item.cantidad - item.cantidad_anulada,
    }));
    const mesaIds = await mesasVigentesDeOrden(this.conexion, orden.id);
    const ahora = this.reloj.ahora();
    const autorizacion = this.sesion.autorizacionConsumida();

    // Una anulación por ítem, con el motivo y el destino de la orden.
    const filas = anulados.map((a) => ({
      id: randomUUID(),
      item_id: a.item.id,
      cantidad: a.cantidad,
      huella: huellaDeAnulacionDeOrden({
        ordenId: orden.id,
        itemId: a.item.id,
        cantidad: a.cantidad,
        motivo: entrada.motivo,
        destinoStock: entrada.destinoStock,
      }).toString('base64'),
    }));
    if (filas.length > 0) {
      await this.conexion.query(
        `INSERT INTO anulacion_item (id, empresa_id, item_id, orden_id, cantidad, motivo, destino_stock,
                                     autorizado_por_id, autorizacion_id, de_orden, huella_entrada,
                                     creado_en, actualizado_en)
         SELECT x.id, $2::uuid, x.item_id, $3::uuid, x.cantidad, $4::text, $5::text, $6::uuid, $7::uuid, true,
                decode(x.huella, 'base64'), $8::timestamptz, $8::timestamptz
           FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, item_id uuid, cantidad int, huella text)`,
        {
          bind: [
            JSON.stringify(filas),
            empresaId,
            orden.id,
            entrada.motivo,
            entrada.destinoStock,
            autorizacion?.autorizadorId ?? null,
            autorizacion?.autorizacionId ?? null,
            ahora,
          ],
        },
      );
      const itemIds = anulados.map((a) => a.item.id);
      await this.conexion.query(
        `UPDATE item SET cantidad_anulada = cantidad, estado = 'ANULADO', actualizado_en = $2
          WHERE id = ANY($1::uuid[])`,
        { bind: [itemIds, ahora], type: QueryTypes.UPDATE },
      );
      await this.anularLineasDeCocina(itemIds, ahora);
    }

    // Las comandas ANULACION por estación; el motivo sale de la primera anulación, igual para todas.
    const comandas = await this.guardarComandasDeAnulacion({
      empresaId,
      sucursalId,
      ordenId: orden.id,
      origenId: filas[0]?.id ?? null,
      ahora,
      anulados,
    });

    // El inventario, una sola vez con todas las partes vigentes; el id es el de la orden (criterio 72).
    await this.inventario.alAnular({
      sucursalId,
      anulacionId: orden.id,
      partes: partesDeStockDeEnvio(
        anulados.map((a) => ({ ...a.item.linea, cantidad: a.cantidad })),
      ),
      destino: entrada.destinoStock,
    });

    await this.conexion.query(
      `UPDATE orden
          SET estado = 'ANULADA', anulada_en = $2, motivo_anulacion = $3, version = version + 1,
              actualizado_en = $2
        WHERE id = $1`,
      { bind: [orden.id, ahora, entrada.motivo], type: QueryTypes.UPDATE },
    );
    await this.conexion.query(
      `UPDATE orden_mesa SET hasta = $2, actualizado_en = $2 WHERE orden_id = $1 AND hasta IS NULL`,
      { bind: [orden.id, ahora], type: QueryTypes.UPDATE },
    );
    if (orden.estado === 'EN_PRECUENTA') {
      await invalidarPrecuentaVigente(this.conexion, orden.id, ahora);
    }

    const [mozo] = await this.conexion.query<{ mozo_id: string | null }>(
      'SELECT mozo_id FROM orden WHERE id = $1',
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const nombresMesas = await this.mesas.nombres(mesaIds);
    await this.auditoria.registrar({
      accion: 'anular_orden',
      entidad: 'orden',
      entidadId: orden.id,
      motivo: entrada.motivo,
      autorizadoPorId: autorizacion?.autorizadorId ?? null,
      autorizacionId: autorizacion?.autorizacionId ?? null,
      detalle: {
        mesas: mesaIds.map((id) => ({ id, nombre: nombresMesas.get(id) ?? '' })),
        mozoId: mozo?.mozo_id ?? null,
        items: anulados.map((a) => ({
          itemId: a.item.id,
          nombre: a.item.nombre,
          cantidadAnulada: a.cantidad,
          totalAnulado: totalVigenteLinea(
            a.item.precio_unitario,
            a.item.cantidad,
            a.item.cantidad_anulada,
          ),
        })),
        totalAnulado: totalOrden(
          anulados.map((a) => ({
            precioUnitario: a.item.precio_unitario,
            cantidad: a.item.cantidad,
            cantidadAnulada: a.item.cantidad_anulada,
          })),
        ),
        destinoStock: entrada.destinoStock,
      },
    });

    // Eventos: solo después de confirmar (criterio 42).
    this.publicarComandas(sucursalId, comandas);
    this.eventos.ordenCambio(sucursalId, orden.id);
    this.eventos.salonCambio(sucursalId, orden.id, mesaIds);
    return this.vista.armar(orden.id, sucursalId);
  }

  // -------------------------------------------------------------------------------------------------

  /**
   * Las líneas de comanda originales de los ítems que se anularon del todo pasan a `ANULADO` (criterio 38): las de
   * la comanda, la adición y la marcha. Las de las comandas `ANULACION` son del ticket de anulación y no cambian.
   */
  private async anularLineasDeCocina(itemIds: readonly string[], ahora: Date): Promise<void> {
    await this.conexion.query(
      `UPDATE comanda_linea cl SET estado = 'ANULADO', estado_en = $2, actualizado_en = $2
         FROM comanda c
        WHERE c.id = cl.comanda_id AND c.empresa_id = cl.empresa_id
          AND cl.item_id = ANY($1::uuid[]) AND c.tipo <> 'ANULACION' AND cl.estado <> 'ANULADO'`,
      { bind: [itemIds, ahora], type: QueryTypes.UPDATE },
    );
  }

  /** Una comanda `ANULACION` por estación con las partes anuladas de cada ítem y su cantidad fija. */
  private async guardarComandasDeAnulacion(entrada: {
    empresaId: string;
    sucursalId: string;
    ordenId: string;
    origenId: string | null;
    ahora: Date;
    anulados: readonly Anulado[];
  }): Promise<ComandaGuardada[]> {
    const partes: ParteParaGuardar[] = entrada.anulados.flatMap(({ item, cantidad }) =>
      partesDeComanda(item.linea, {
        observacion: item.observacion,
        tiempo: item.tiempo,
        paraLlevar: item.para_llevar,
      }).map((parte) => {
        const porItem = parte.cantidad / item.linea.cantidad;
        return {
          itemId: item.id,
          parte,
          cantidadPorItem: porItem,
          cantidadFija: porItem * cantidad,
          esperar: false,
        };
      }),
    );
    return guardarComandas(this.conexion, this.impresion, {
      empresaId: entrada.empresaId,
      sucursalId: entrada.sucursalId,
      ordenId: entrada.ordenId,
      envioId: null,
      tipo: 'ANULACION',
      origenId: entrada.origenId,
      ahora: entrada.ahora,
      partes,
    });
  }

  /**
   * Sube la versión de la orden y, si estaba en pre-cuenta, la devuelve a `ABIERTA` e invalida la pre-cuenta
   * vigente, también con una anulación parcial (criterio 40, decisión 10). Devuelve si estaba en pre-cuenta.
   */
  private async cambiarLaOrden(ordenId: string, estado: string, ahora: Date): Promise<boolean> {
    await this.conexion.query(
      `UPDATE orden
          SET version = version + 1,
              estado = CASE WHEN estado = 'EN_PRECUENTA' THEN 'ABIERTA' ELSE estado END,
              actualizado_en = $2
        WHERE id = $1`,
      { bind: [ordenId, ahora], type: QueryTypes.UPDATE },
    );
    const estabaEnPrecuenta = estado === 'EN_PRECUENTA';
    if (estabaEnPrecuenta) await invalidarPrecuentaVigente(this.conexion, ordenId, ahora);
    return estabaEnPrecuenta;
  }

  private publicarComandas(sucursalId: string, comandas: readonly ComandaGuardada[]): void {
    for (const c of comandas) {
      this.eventos.cocinaComanda(sucursalId, {
        comandaId: c.id,
        estacionId: c.estacionId,
        tipo: c.tipo,
      });
    }
  }
}
