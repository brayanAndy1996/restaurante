import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CampoError,
  EnvioEntradaValidada,
  EnvioRespuesta,
  LineaPreparada,
  MarchaEntrada,
  MarchaRespuesta,
} from '@restaurante/contratos';
import {
  excedeMontoMaximo,
  partesDeComanda,
  partesDeStockDeEnvio,
  totalOrden,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CartaVentaService, ErrorProductoNoVendible, ErrorSeleccionInvalida } from '../carta';
import { SesionActual } from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import { guardarComandas, type ParteParaGuardar } from './comandas';
import {
  idDeClienteReutilizado,
  itemsNoMarchables,
  lineasRechazadas,
  montoFueraDeRango,
  nadaQueMarchar,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { IMPRESION, type ImpresionPuerto } from './impresion';
import { INVENTARIO, type InventarioPuerto } from './inventario';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { invalidarPrecuentaVigente } from './precuenta-invalidacion';
import { huellaDeEnvio, huellaDeMarcha, normalizarLineas } from './replica';
import { VistaOrdenService } from './vista-orden';

interface FilaReplica {
  orden_id: string;
  huella_entrada: Buffer;
}

interface FilaItemPorMarchar {
  id: string;
  cantidad: number;
  cantidad_anulada: number;
  linea: LineaPreparada;
  observacion: string | null;
  tiempo: 1 | 2;
  para_llevar: boolean;
}

/** Un rechazo de `prepararLinea` convertido en la entrada de `campos` de su línea (criterios 17 y 20). */
interface RechazoDeLinea {
  codigo: ErrorAplicacion['codigo'];
  mensaje: string;
  campo: CampoError;
}

/**
 * Enviar la comanda y marchar (historia 004, criterios 15 a 33; ruta crítica P2). Todo corre en la transacción
 * de la petición, con la empresa y el actor de la sesión; la sucursal es siempre la activa de la sesión.
 *
 * Orden de las comprobaciones de un envío (plan, "Enviar"): la orden se bloquea (`FOR UPDATE`; serializa los
 * envíos, las marchas, las anulaciones, las uniones y las pre-cuentas de la misma orden, y con ello el número
 * del envío y "es adición"); la réplica por el id del envío (antes del estado de la orden y de las líneas, así
 * una réplica después de anular o agotar devuelve el éxito original); el estado; cada línea con
 * `prepararLinea`; los topes de monto; los `INSERT`; el puerto de inventario (dentro de la transacción: si
 * lanza, no queda nada); y los eventos, que salen solo después de confirmar.
 */
@Injectable()
export class EnviosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(CartaVentaService) private readonly carta: CartaVentaService,
    @Inject(INVENTARIO) private readonly inventario: InventarioPuerto,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
    @Inject(VistaOrdenService) private readonly vista: VistaOrdenService,
  ) {}

  // -------------------------------------------------------------------------------------------------
  // Enviar (criterios 15 a 31)
  // -------------------------------------------------------------------------------------------------

  async enviar(ordenId: string, entrada: EnvioEntradaValidada): Promise<EnvioRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const envioId = entrada.id.toLowerCase();

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);

    // Réplica por el id del envío (criterio 26): antes de mirar el estado de la orden y las líneas.
    const lineasNormalizadas = normalizarLineas(entrada.lineas);
    const huella = huellaDeEnvio(lineasNormalizadas);
    const previo = await this.buscarReplica('envio', envioId);
    if (previo !== undefined) {
      if (previo.orden_id !== orden.id || !previo.huella_entrada.equals(huella)) {
        throw idDeClienteReutilizado();
      }
      return this.vista.armarEnvio(envioId, sucursalId);
    }
    exigirOrdenAbierta(orden);

    const ahora = this.reloj.ahora();
    const preparadas = await this.prepararLineas(sucursalId, entrada, ahora);
    await this.exigirMontosEnRango(orden.id, preparadas);

    // El número del envío y "es adición" se calculan con la orden bloqueada (criterio 28). Es adición si la
    // orden ya tiene ítems (también los que llegaron al unir otra orden, criterio 47).
    const [siguiente] = await this.conexion.query<{ numero: number; hay_items: boolean }>(
      `SELECT coalesce(max(numero), 0) + 1 AS numero,
              EXISTS (SELECT 1 FROM item WHERE orden_id = $1) AS hay_items
         FROM envio WHERE orden_id = $1`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const numero = siguiente!.numero;
    const esAdicion = siguiente!.hay_items;

    const insertado = await this.conexion.query<{ id: string }>(
      `INSERT INTO envio (id, empresa_id, orden_id, numero, es_adicion, huella_entrada, creado_en,
                          actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (empresa_id, id) DO NOTHING
       RETURNING id`,
      {
        bind: [envioId, empresaId, orden.id, numero, esAdicion, huella, ahora],
        type: QueryTypes.SELECT,
      },
    );
    // El mismo id lo guardó otra petición de otra orden mientras esta esperaba: no es una réplica.
    if (insertado.length === 0) throw idDeClienteReutilizado();

    // Los ítems, con la línea preparada tal como era (criterio 16).
    const items = preparadas.map((linea, indice) => ({
      id: randomUUID(),
      linea,
      pedida: entrada.lineas[indice]!,
      posicion: indice + 1,
    }));
    await this.conexion.query(
      `INSERT INTO item (id, empresa_id, orden_id, envio_id, producto_id, nombre, tipo_producto, cantidad,
                         cantidad_anulada, precio_unitario, total, afectacion_igv, aplica_icbper, linea,
                         observacion, tiempo, para_llevar, es_adicion, estado, posicion, creado_en,
                         actualizado_en)
       SELECT x.id, $2::uuid, $3::uuid, $4::uuid, x.producto_id, x.nombre, x.tipo_producto, x.cantidad, 0,
              x.precio_unitario::numeric, x.total::numeric, x.afectacion_igv, x.aplica_icbper, x.linea,
              x.observacion, x.tiempo, x.para_llevar, $5::boolean, 'ENVIADO', x.posicion,
              $6::timestamptz, $6::timestamptz
         FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, producto_id uuid, nombre text,
              tipo_producto text, cantidad int, precio_unitario text, total text, afectacion_igv text,
              aplica_icbper boolean, linea jsonb, observacion text, tiempo int, para_llevar boolean,
              posicion int)`,
      {
        bind: [
          JSON.stringify(
            items.map((i) => ({
              id: i.id,
              producto_id: i.linea.productoId,
              nombre: i.linea.nombre,
              tipo_producto: i.linea.tipo,
              cantidad: i.linea.cantidad,
              precio_unitario: i.linea.precioUnitario,
              total: i.linea.total,
              afectacion_igv: i.linea.afectacionIgv,
              aplica_icbper: i.linea.aplicaIcbper,
              linea: i.linea,
              observacion: i.pedida.observacion ?? null,
              tiempo: i.pedida.tiempo,
              para_llevar: i.pedida.paraLlevar,
              posicion: i.posicion,
            })),
          ),
          empresaId,
          orden.id,
          envioId,
          esAdicion,
          ahora,
        ],
      },
    );

    // Ruteo por estación (criterio 22): una comanda por estación con las partes de todos los ítems.
    const partes: ParteParaGuardar[] = items.flatMap((i) =>
      partesDeComanda(i.linea, {
        observacion: i.pedida.observacion ?? null,
        tiempo: i.pedida.tiempo,
        paraLlevar: i.pedida.paraLlevar,
      }).map((parte) => ({
        itemId: i.id,
        parte,
        cantidadPorItem: parte.cantidad / i.linea.cantidad,
        cantidadFija: null,
        esperar: i.pedida.tiempo === 2,
      })),
    );
    const comandas = await guardarComandas(this.conexion, this.impresion, {
      empresaId,
      sucursalId,
      ordenId: orden.id,
      envioId,
      tipo: esAdicion ? 'ADICION' : 'COMANDA',
      origenId: null,
      ahora,
      partes,
    });

    // El inventario, dentro de la transacción y una sola vez por envío (criterio 72): si lanza, se revierte todo.
    await this.inventario.alEnviar({
      sucursalId,
      envioId,
      partes: partesDeStockDeEnvio(preparadas),
    });

    // Una adición saca la orden de la pre-cuenta e invalida la vigente (criterio 23).
    const estabaEnPrecuenta = orden.estado === 'EN_PRECUENTA';
    await this.conexion.query(
      `UPDATE orden
          SET version = version + 1,
              estado = CASE WHEN estado = 'EN_PRECUENTA' THEN 'ABIERTA' ELSE estado END,
              actualizado_en = $2
        WHERE id = $1`,
      { bind: [orden.id, ahora], type: QueryTypes.UPDATE },
    );
    if (estabaEnPrecuenta) await invalidarPrecuentaVigente(this.conexion, orden.id, ahora);

    // Eventos: solo después de confirmar (criterio 31).
    for (const c of comandas) {
      this.eventos.cocinaComanda(sucursalId, {
        comandaId: c.id,
        estacionId: c.estacionId,
        tipo: c.tipo,
      });
    }
    this.eventos.ordenCambio(sucursalId, orden.id);
    if (estabaEnPrecuenta) {
      this.eventos.salonCambio(
        sucursalId,
        orden.id,
        await mesasVigentesDeOrden(this.conexion, orden.id),
      );
    }

    return this.vista.armarEnvio(envioId, sucursalId);
  }

  /**
   * Valida cada línea con `CartaVentaService.prepararLinea` (criterios 16 a 20) y junta los rechazos de todas:
   * 422 con una entrada de `campos` por línea rechazada y el código de la primera. Un producto de otra empresa
   * o inexistente se rechaza igual (criterio 20).
   */
  private async prepararLineas(
    sucursalId: string,
    entrada: EnvioEntradaValidada,
    instante: Date,
  ): Promise<LineaPreparada[]> {
    const preparadas: LineaPreparada[] = [];
    const rechazos: RechazoDeLinea[] = [];
    for (const [indice, linea] of entrada.lineas.entries()) {
      try {
        preparadas.push(
          await this.carta.prepararLinea({
            sucursalId,
            productoId: linea.productoId,
            modificadorIds: linea.modificadorIds,
            cantidad: linea.cantidad,
            instante,
          }),
        );
      } catch (error) {
        const rechazo = rechazoDeLinea(indice, error);
        if (rechazo === undefined) throw error;
        rechazos.push(rechazo);
      }
    }
    const primero = rechazos[0];
    if (primero !== undefined) {
      throw lineasRechazadas(
        { codigo: primero.codigo, message: primero.mensaje },
        rechazos.map((r) => r.campo),
      );
    }
    return preparadas;
  }

  /**
   * Topes de monto (criterio 21; reglas de `packages/dominio`): ninguna línea pasa de `MONTO_MAXIMO` (se señalan
   * todas las que se pasan) y el total de la orden después del envío, con lo vigente de antes, tampoco.
   */
  private async exigirMontosEnRango(
    ordenId: string,
    preparadas: readonly LineaPreparada[],
  ): Promise<void> {
    const fuera: CampoError[] = [];
    preparadas.forEach((linea, indice) => {
      if (excedeMontoMaximo(linea.precioUnitario) || excedeMontoMaximo(linea.total)) {
        fuera.push({ campo: `lineas.${indice}`, mensaje: 'El monto de la línea supera el máximo' });
      }
    });
    if (fuera.length > 0) throw montoFueraDeRango(fuera);

    const existentes = await this.conexion.query<{
      precio_unitario: string;
      cantidad: number;
      cantidad_anulada: number;
    }>('SELECT precio_unitario, cantidad, cantidad_anulada FROM item WHERE orden_id = $1', {
      bind: [ordenId],
      type: QueryTypes.SELECT,
    });
    const total = totalOrden([
      ...existentes.map((i) => ({
        precioUnitario: i.precio_unitario,
        cantidad: i.cantidad,
        cantidadAnulada: i.cantidad_anulada,
      })),
      ...preparadas.map((l) => ({
        precioUnitario: l.precioUnitario,
        cantidad: l.cantidad,
        cantidadAnulada: 0,
      })),
    ]);
    if (excedeMontoMaximo(total)) {
      throw montoFueraDeRango([
        { campo: 'lineas', mensaje: 'El total de la orden supera el máximo' },
      ]);
    }
  }

  // -------------------------------------------------------------------------------------------------
  // Marchar (criterios 32 y 33)
  // -------------------------------------------------------------------------------------------------

  async marchar(ordenId: string, entrada: MarchaEntrada): Promise<MarchaRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const marchaId = entrada.id.toLowerCase();
    const pedidos = entrada.itemIds?.map((id) => id.toLowerCase());

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);

    // Réplica por el id de la marcha: antes del estado de la orden y de buscar qué marchar.
    const huella = huellaDeMarcha(entrada.itemIds);
    const previa = await this.buscarReplica('marcha', marchaId);
    if (previa !== undefined) {
      if (previa.orden_id !== orden.id || !previa.huella_entrada.equals(huella)) {
        throw idDeClienteReutilizado();
      }
      return this.vista.armarMarcha(marchaId);
    }
    exigirOrdenAbierta(orden);

    // Los ítems de segundo tiempo enviados, sin marchar y con cantidad vigente de la orden (los de una orden
    // unida ya están en la principal).
    const candidatos = await this.conexion.query<FilaItemPorMarchar>(
      `SELECT i.id, i.cantidad, i.cantidad_anulada, i.linea, i.observacion, i.tiempo, i.para_llevar
         FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
        WHERE i.orden_id = $1 AND i.tiempo = 2 AND i.marchado_en IS NULL
          AND i.cantidad > i.cantidad_anulada
        ORDER BY e.numero, i.posicion, i.id`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    let elegidos = candidatos;
    if (pedidos !== undefined) {
      const marchables = new Set(candidatos.map((i) => i.id));
      const malos = pedidos.flatMap((id, indice) => (marchables.has(id) ? [] : [indice]));
      if (malos.length > 0) throw itemsNoMarchables(malos);
      const nombrados = new Set(pedidos);
      elegidos = candidatos.filter((i) => nombrados.has(i.id));
    } else if (candidatos.length === 0) {
      throw nadaQueMarchar();
    }

    const ahora = this.reloj.ahora();
    const insertada = await this.conexion.query<{ id: string }>(
      `INSERT INTO marcha (id, empresa_id, orden_id, huella_entrada, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (empresa_id, id) DO NOTHING
       RETURNING id`,
      { bind: [marchaId, empresaId, orden.id, huella, ahora], type: QueryTypes.SELECT },
    );
    if (insertada.length === 0) throw idDeClienteReutilizado();

    // Las líneas originales dejan de esperar y cada estación recibe una comanda MARCHAR con las partes de esos
    // ítems (con la cantidad vigente fija de cada una).
    const itemIds = elegidos.map((i) => i.id);
    await this.conexion.query(
      `UPDATE comanda_linea SET esperar = false, actualizado_en = $2
        WHERE item_id = ANY($1::uuid[]) AND esperar`,
      { bind: [itemIds, ahora], type: QueryTypes.UPDATE },
    );
    const partes: ParteParaGuardar[] = elegidos.flatMap((item) => {
      const vigente = item.cantidad - item.cantidad_anulada;
      return partesDeComanda(item.linea, {
        observacion: item.observacion,
        tiempo: item.tiempo,
        paraLlevar: item.para_llevar,
      }).map((parte) => {
        const porItem = parte.cantidad / item.linea.cantidad;
        return {
          itemId: item.id,
          parte,
          cantidadPorItem: porItem,
          cantidadFija: porItem * vigente,
          esperar: false,
        };
      });
    });
    const comandas = await guardarComandas(this.conexion, this.impresion, {
      empresaId,
      sucursalId,
      ordenId: orden.id,
      envioId: null,
      tipo: 'MARCHAR',
      origenId: marchaId,
      ahora,
      partes,
    });
    await this.conexion.query(
      `UPDATE item SET marchado_en = $2, actualizado_en = $2 WHERE id = ANY($1::uuid[])`,
      { bind: [itemIds, ahora], type: QueryTypes.UPDATE },
    );

    for (const c of comandas) {
      this.eventos.cocinaComanda(sucursalId, {
        comandaId: c.id,
        estacionId: c.estacionId,
        tipo: c.tipo,
      });
    }
    this.eventos.ordenCambio(sucursalId, orden.id);
    return this.vista.armarMarcha(marchaId);
  }

  // -------------------------------------------------------------------------------------------------

  /** El envío o la marcha con ese id en la empresa (la RLS la limita), de cualquier orden. */
  private async buscarReplica(
    tabla: 'envio' | 'marcha',
    id: string,
  ): Promise<FilaReplica | undefined> {
    const filas = await this.conexion.query<FilaReplica>(
      `SELECT orden_id, huella_entrada FROM ${tabla} WHERE id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    return filas[0];
  }
}

/**
 * Convierte el rechazo de `prepararLinea` en la entrada de `campos` de su línea (criterio 17): el motivo de un
 * producto que no se vende, los errores de una selección inválida y, para un producto de otra empresa o
 * inexistente, un mensaje fijo sin el id (criterio 20). Devuelve `undefined` si el error no es un rechazo de la
 * línea (se propaga).
 */
function rechazoDeLinea(indice: number, error: unknown): RechazoDeLinea | undefined {
  const campo = `lineas.${indice}`;
  if (error instanceof ErrorProductoNoVendible) {
    return {
      codigo: error.codigo,
      mensaje: error.message,
      campo: { campo, mensaje: error.motivo },
    };
  }
  if (error instanceof ErrorSeleccionInvalida) {
    // Un modificador desconocido (de otra empresa o inexistente) se informa sin el id: el cuerpo es el mismo
    // para los dos (criterio 85).
    const detalle = (error.campos ?? []).map((c) => {
      if (c.campo.startsWith('grupos.')) return `${c.mensaje} (${c.campo})`;
      return c.mensaje.startsWith('MODIFICADOR_DESCONOCIDO')
        ? 'MODIFICADOR_DESCONOCIDO'
        : c.mensaje;
    });
    return {
      codigo: error.codigo,
      mensaje: error.message,
      campo: { campo, mensaje: detalle.join('; ') },
    };
  }
  if (error instanceof ErrorAplicacion && error.codigo === 'NO_ENCONTRADO') {
    return {
      codigo: 'PRODUCTO_NO_VENDIBLE',
      mensaje: 'El producto no existe',
      campo: { campo, mensaje: 'PRODUCTO_NO_EXISTE' },
    };
  }
  return undefined;
}
