import { Inject, Injectable } from '@nestjs/common';
import type { MoverEntrada, OrdenRespuesta, UnirEntrada } from '@restaurante/contratos';
import {
  MAXIMO_MESAS_ORDEN,
  excedeMontoMaximo,
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
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import { bloquearOrdenes, exigirOrdenAbierta, type OrdenBloqueada } from './bloqueos-orden';
import {
  demasiadasMesas,
  mesaInactiva,
  mesaOcupada,
  mesaOrigenInvalida,
  mesaOrigenRequerida,
  montoFueraDeRango,
  operacionConcurrente,
  ordenNoEncontrada,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { invalidarPrecuentaVigente } from './precuenta-invalidacion';
import { VistaOrdenService } from './vista-orden';

/** El tope de comensales de una orden (`orden_comensales` CHECK 1 a 99). */
const MAXIMO_COMENSALES = 99;

/** Cuántas veces se vuelve a leer quién ocupa las mesas antes de rendirse con `CONFLICTO` (plan). */
const INTENTOS_DE_BLOQUEO = 2;

interface OcupacionDeMesa {
  mesaId: string;
  ordenId: string;
}

interface ItemParaTotal {
  precio_unitario: string;
  cantidad: number;
  cantidad_anulada: number;
}

interface ItemAbsorbido {
  id: string;
  nombre: string;
  cantidad: number;
  cantidad_anulada: number;
  precio_unitario: string;
  creado_por_usuario_id: string | null;
}

/** Una orden absorbida por la unión, con lo que hay que guardar de ella en la auditoría. */
interface Absorbida {
  orden: OrdenBloqueada;
  mozoId: string | null;
  mesaIds: string[];
  items: ItemAbsorbido[];
}

/**
 * Mover una orden a otra mesa y unir mesas a una orden (historia 004, criterios 45 a 49).
 *
 * **Bloqueos.** Siempre se toman primero las órdenes (en orden de id, en una sola consulta) y después las
 * mesas (también en orden de id): ni la apertura (solo la mesa) ni el envío (solo la orden) cierran un ciclo, y
 * dos uniones cruzadas toman las mismas órdenes en el mismo orden. Lo que se escape lo traduce el filtro de
 * errores a 409 `CONFLICTO` (`40P01`). Para saber qué órdenes ocupan las mesas pedidas se lee `orden_mesa` sin
 * bloqueo, se bloquean esas órdenes y se vuelve a leer; si cambió, se repite una vez y luego 409 `CONFLICTO`.
 * Lo que se decide (qué mesas son nuevas, qué órdenes se absorben) sale siempre de la lectura posterior al
 * bloqueo.
 */
@Injectable()
export class MovimientosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
    @Inject(VistaOrdenService) private readonly vista: VistaOrdenService,
  ) {}

  /** Quién ocupa ahora cada una de las mesas (solo las de la sucursal y con una orden vigente). */
  private async ocupantes(
    mesaIds: readonly string[],
    sucursalId: string,
  ): Promise<OcupacionDeMesa[]> {
    const filas = await this.conexion.query<{ mesa_id: string; orden_id: string }>(
      `SELECT om.mesa_id, om.orden_id
         FROM orden_mesa om JOIN orden o ON o.id = om.orden_id AND o.empresa_id = om.empresa_id
        WHERE om.mesa_id = ANY($1::uuid[]) AND om.hasta IS NULL AND o.sucursal_id = $2
        ORDER BY om.mesa_id`,
      { bind: [[...mesaIds], sucursalId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => ({ mesaId: f.mesa_id, ordenId: f.orden_id }));
  }

  // -------------------------------------------------------------------------------------------------
  // Mover (criterio 45)
  // -------------------------------------------------------------------------------------------------

  /**
   * Cambia la mesa de la orden: cierra la relación con la de origen y abre otra con la de destino, que debe ser
   * activa, de la sucursal y estar libre (ocupada, 409 `MESA_OCUPADA` con la orden que la ocupa). Repetirlo
   * cuando la orden ya está en la mesa de destino responde 200 sin otro efecto. No cambia el estado de la orden,
   * sus ítems, su pre-cuenta ni su mozo, y no se audita (queda el historial de `orden_mesa`).
   */
  async mover(ordenId: string, entrada: MoverEntrada): Promise<OrdenRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const destinoId = entrada.mesaDestinoId.toLowerCase();
    const origenDado = entrada.mesaOrigenId?.toLowerCase();

    const bloqueadas = await bloquearOrdenes(this.conexion, [ordenId], sucursalId);
    const orden = bloqueadas.get(ordenId);
    if (orden === undefined) throw ordenNoEncontrada();
    exigirOrdenAbierta(orden);

    const vigentes = await mesasVigentesDeOrden(this.conexion, orden.id);
    if (vigentes.length > 1 && origenDado === undefined && !vigentes.includes(destinoId)) {
      throw mesaOrigenRequerida();
    }

    // Las mesas por id, juntas: 404 si alguna no es de la sucursal (la misma respuesta que una inexistente).
    const quienes = [destinoId];
    if (origenDado !== undefined) quienes.push(origenDado);
    else if (vigentes.length === 1) quienes.push(vigentes[0]!);
    const bloqueo = await this.mesas.bloquear(quienes, sucursalId);

    // Ya está en la mesa de destino: nada que hacer (también la repetición de un movimiento hecho).
    if (vigentes.includes(destinoId)) return this.vista.armar(orden.id, sucursalId);

    const origenId = origenDado ?? vigentes[0];
    if (origenId === undefined || !vigentes.includes(origenId)) throw mesaOrigenInvalida();

    const destino = bloqueo.find((m) => m.id === destinoId);
    if (destino === undefined || !destino.activa) throw mesaInactiva();
    const [ocupante] = await this.ocupantes([destinoId], sucursalId);
    if (ocupante !== undefined) throw mesaOcupada(ocupante.ordenId);

    const ahora = this.reloj.ahora();
    const empresaId = this.contexto.empresaActual();
    await this.conexion.query(
      `UPDATE orden_mesa SET hasta = $3, actualizado_en = $3
        WHERE orden_id = $1 AND mesa_id = $2 AND hasta IS NULL`,
      { bind: [orden.id, origenId, ahora], type: QueryTypes.UPDATE },
    );
    await this.conexion.query(
      `INSERT INTO orden_mesa (empresa_id, orden_id, mesa_id, desde, hasta, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, NULL, $4, $4)`,
      { bind: [empresaId, orden.id, destinoId, ahora], type: QueryTypes.INSERT },
    );
    await this.conexion.query(`UPDATE orden SET actualizado_en = $2 WHERE id = $1`, {
      bind: [orden.id, ahora],
      type: QueryTypes.UPDATE,
    });

    this.eventos.salonCambio(sucursalId, orden.id, [origenId, destinoId]);
    this.eventos.ordenCambio(sucursalId, orden.id);
    return this.vista.armar(orden.id, sucursalId);
  }

  // -------------------------------------------------------------------------------------------------
  // Unir (criterios 46 a 49)
  // -------------------------------------------------------------------------------------------------

  /**
   * Agrega a la orden las mesas de la lista. Las libres pasan a la orden; si una mesa tiene otra orden abierta
   * (decisión 9), esa orden se une a la principal: sus ítems pasan a la principal (conservan su autor, su envío y
   * sus comandas), sus mesas y sus comensales se suman y queda `UNIDA` con `unida_a_orden_id`. La venta se
   * atribuye al mozo de la principal. Una mesa que ya es de la orden se ignora; si no queda ninguna por unir, 200
   * sin otro efecto. Si pasaron ítems y la principal estaba `EN_PRECUENTA`, vuelve a `ABIERTA` y su pre-cuenta se
   * invalida; la pre-cuenta de la absorbida también.
   */
  async unir(ordenId: string, entrada: UnirEntrada): Promise<OrdenRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const pedidas = [...new Set(entrada.mesaIds.map((id) => id.toLowerCase()))];

    // 1. Bloqueos: órdenes antes que mesas, por id; relectura de quién ocupa las mesas.
    const bloqueadas = new Map<string, OrdenBloqueada>();
    let ocupacion: OcupacionDeMesa[] = [];
    for (let intento = 1; ; intento += 1) {
      const previas = await this.ocupantes(pedidas, sucursalId);
      const tomadas = await bloquearOrdenes(
        this.conexion,
        [ordenId, ...previas.map((o) => o.ordenId)],
        sucursalId,
      );
      for (const [id, orden] of tomadas) bloqueadas.set(id, orden);
      const principal = bloqueadas.get(ordenId);
      if (principal === undefined) throw ordenNoEncontrada();
      exigirOrdenAbierta(principal);

      const mesas = await this.mesas.bloquear(pedidas, sucursalId);
      ocupacion = await this.ocupantes(pedidas, sucursalId);
      if (ocupacion.every((o) => bloqueadas.has(o.ordenId))) {
        this.exigirMesasActivas(mesas, ocupacion, ordenId);
        break;
      }
      if (intento >= INTENTOS_DE_BLOQUEO) throw operacionConcurrente();
    }
    const principal = bloqueadas.get(ordenId)!;

    // 2. Qué hay que unir, con la orden y las mesas ya bloqueadas.
    const vigentes = await mesasVigentesDeOrden(this.conexion, principal.id);
    const nuevas = pedidas.filter((id) => !vigentes.includes(id));
    if (nuevas.length === 0) return this.vista.armar(principal.id, sucursalId);

    const ordenesAbsorbidas = [
      ...new Set(ocupacion.filter((o) => o.ordenId !== principal.id).map((o) => o.ordenId)),
    ].sort();
    const absorbidas: Absorbida[] = [];
    for (const id of ordenesAbsorbidas) {
      const orden = bloqueadas.get(id)!;
      exigirOrdenAbierta(orden);
      absorbidas.push(await this.leerAbsorbida(orden));
    }

    const mesasFinales = new Set<string>([
      ...vigentes,
      ...nuevas,
      ...absorbidas.flatMap((a) => a.mesaIds),
    ]);
    if (mesasFinales.size > MAXIMO_MESAS_ORDEN) throw demasiadasMesas(MAXIMO_MESAS_ORDEN);
    await this.exigirTotalEnRango(principal, absorbidas);

    // 3. Cambios.
    const ahora = this.reloj.ahora();
    const libres = nuevas.filter((id) => !ocupacion.some((o) => o.mesaId === id));
    let itemsPasados = 0;
    for (const absorbida of absorbidas) {
      itemsPasados += absorbida.items.length;
      await this.absorber(absorbida, principal.id, empresaId, ahora);
    }
    if (libres.length > 0) {
      await this.conexion.query(
        `INSERT INTO orden_mesa (empresa_id, orden_id, mesa_id, desde, hasta, creado_en, actualizado_en)
         SELECT $1::uuid, $2::uuid, m, $4::timestamptz, NULL, $4::timestamptz, $4::timestamptz
           FROM unnest($3::uuid[]) AS m`,
        { bind: [empresaId, principal.id, libres, ahora], type: QueryTypes.INSERT },
      );
    }

    const comensalesSumados = absorbidas.reduce((suma, a) => suma + a.orden.comensales, 0);
    const cambiaronItems = itemsPasados > 0;
    const estabaEnPrecuenta = principal.estado === 'EN_PRECUENTA';
    await this.conexion.query(
      `UPDATE orden
          SET comensales = LEAST($2::int, comensales + $3::int),
              version = version + $4::int,
              estado = CASE WHEN $5::boolean AND estado = 'EN_PRECUENTA' THEN 'ABIERTA' ELSE estado END,
              actualizado_en = $6
        WHERE id = $1`,
      {
        bind: [
          principal.id,
          MAXIMO_COMENSALES,
          comensalesSumados,
          cambiaronItems ? 1 : 0,
          cambiaronItems,
          ahora,
        ],
        type: QueryTypes.UPDATE,
      },
    );
    if (cambiaronItems && estabaEnPrecuenta) {
      await invalidarPrecuentaVigente(this.conexion, principal.id, ahora);
    }

    if (absorbidas.length > 0) await this.auditar(principal, absorbidas);

    // 4. Eventos: solo después de confirmar.
    const finales = await mesasVigentesDeOrden(this.conexion, principal.id);
    this.eventos.salonCambio(sucursalId, principal.id, finales);
    this.eventos.ordenCambio(sucursalId, principal.id);
    for (const absorbida of absorbidas) this.eventos.ordenCambio(sucursalId, absorbida.orden.id);
    return this.vista.armar(principal.id, sucursalId);
  }

  /**
   * El total de la orden resultante (sus ítems vigentes más los de las absorbidas) no puede pasar el tope de un
   * monto (criterios 21 y 76), como en el envío: 422 `MONTO_FUERA_DE_RANGO` y no cambia nada. Unir solo mesas
   * libres no agrega ítems, así que no hay nada que comprobar.
   */
  private async exigirTotalEnRango(
    principal: OrdenBloqueada,
    absorbidas: readonly Absorbida[],
  ): Promise<void> {
    if (absorbidas.every((a) => a.items.length === 0)) return;
    const propios = await this.conexion.query<ItemParaTotal>(
      'SELECT precio_unitario, cantidad, cantidad_anulada FROM item WHERE orden_id = $1',
      { bind: [principal.id], type: QueryTypes.SELECT },
    );
    const total = totalOrden(
      [...propios, ...absorbidas.flatMap((a) => a.items)].map((i) => ({
        precioUnitario: i.precio_unitario,
        cantidad: i.cantidad,
        cantidadAnulada: i.cantidad_anulada,
      })),
    );
    if (excedeMontoMaximo(total)) {
      throw montoFueraDeRango([
        { campo: 'mesaIds', mensaje: 'El total de la orden unida supera el máximo' },
      ]);
    }
  }

  /** Una mesa inactiva libre no se puede unir (409 `CONFLICTO`); una que ya está ocupada por una orden se une con ella. */
  private exigirMesasActivas(
    mesas: readonly { id: string; activa: boolean }[],
    ocupacion: readonly OcupacionDeMesa[],
    principalId: string,
  ): void {
    for (const mesa of mesas) {
      const ocupadaPorOtra = ocupacion.some(
        (o) => o.mesaId === mesa.id && o.ordenId !== principalId,
      );
      const yaEsDeLaOrden = ocupacion.some(
        (o) => o.mesaId === mesa.id && o.ordenId === principalId,
      );
      if (!mesa.activa && !ocupadaPorOtra && !yaEsDeLaOrden) throw mesaInactiva();
    }
  }

  /** Lo que se guarda de la orden absorbida antes de moverla: su mozo, sus mesas vigentes y sus ítems. */
  private async leerAbsorbida(orden: OrdenBloqueada): Promise<Absorbida> {
    const [datos] = await this.conexion.query<{ mozo_id: string | null }>(
      'SELECT mozo_id FROM orden WHERE id = $1',
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const items = await this.conexion.query<ItemAbsorbido>(
      `SELECT i.id, i.nombre, i.cantidad, i.cantidad_anulada, i.precio_unitario, i.creado_por_usuario_id
         FROM item i WHERE i.orden_id = $1 ORDER BY i.creado_en, i.posicion, i.id`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    return {
      orden,
      mozoId: datos?.mozo_id ?? null,
      mesaIds: await mesasVigentesDeOrden(this.conexion, orden.id),
      items,
    };
  }

  /**
   * Pasa los ítems y las mesas de la absorbida a la principal (cerrando sus relaciones y abriendo otras para
   * conservar el historial), la deja `UNIDA` e invalida su pre-cuenta.
   */
  private async absorber(
    absorbida: Absorbida,
    principalId: string,
    empresaId: string,
    ahora: Date,
  ): Promise<void> {
    const id = absorbida.orden.id;
    await this.conexion.query(
      `UPDATE item SET orden_id = $2, actualizado_en = $3 WHERE orden_id = $1`,
      { bind: [id, principalId, ahora], type: QueryTypes.UPDATE },
    );
    await this.conexion.query(
      `UPDATE orden_mesa SET hasta = $2, actualizado_en = $2 WHERE orden_id = $1 AND hasta IS NULL`,
      { bind: [id, ahora], type: QueryTypes.UPDATE },
    );
    if (absorbida.mesaIds.length > 0) {
      await this.conexion.query(
        `INSERT INTO orden_mesa (empresa_id, orden_id, mesa_id, desde, hasta, creado_en, actualizado_en)
         SELECT $1::uuid, $2::uuid, m, $4::timestamptz, NULL, $4::timestamptz, $4::timestamptz
           FROM unnest($3::uuid[]) AS m`,
        { bind: [empresaId, principalId, absorbida.mesaIds, ahora], type: QueryTypes.INSERT },
      );
    }
    await this.conexion.query(
      `UPDATE orden
          SET estado = 'UNIDA', unida_a_orden_id = $2, version = version + 1, actualizado_en = $3
        WHERE id = $1`,
      { bind: [id, principalId, ahora], type: QueryTypes.UPDATE },
    );
    await invalidarPrecuentaVigente(this.conexion, id, ahora);
  }

  /** La fila `unir_ordenes` (criterio 47): el mozo, las mesas y los ítems de cada orden absorbida. */
  private async auditar(
    principal: OrdenBloqueada,
    absorbidas: readonly Absorbida[],
  ): Promise<void> {
    const personas = await this.usuarios.nombres([
      ...absorbidas.flatMap((a) => (a.mozoId === null ? [] : [a.mozoId])),
      ...absorbidas.flatMap((a) =>
        a.items.flatMap((i) => (i.creado_por_usuario_id === null ? [] : [i.creado_por_usuario_id])),
      ),
    ]);
    const [mozo] = await this.conexion.query<{ mozo_id: string | null }>(
      'SELECT mozo_id FROM orden WHERE id = $1',
      { bind: [principal.id], type: QueryTypes.SELECT },
    );
    const nombresMesas = await this.mesas.nombres(absorbidas.flatMap((a) => a.mesaIds));
    await this.auditoria.registrar({
      accion: 'unir_ordenes',
      entidad: 'orden',
      entidadId: principal.id,
      detalle: {
        mozoId: mozo?.mozo_id ?? null,
        absorbidas: absorbidas.map((a) => ({
          ordenId: a.orden.id,
          mozoId: a.mozoId,
          mozoNombre: a.mozoId === null ? null : (personas.get(a.mozoId) ?? ''),
          comensales: a.orden.comensales,
          mesas: a.mesaIds.map((id) => ({ id, nombre: nombresMesas.get(id) ?? '' })),
          items: a.items.map((i) => ({
            itemId: i.id,
            nombre: i.nombre,
            cantidad: i.cantidad,
            cantidadAnulada: i.cantidad_anulada,
            totalVigente: totalVigenteLinea(i.precio_unitario, i.cantidad, i.cantidad_anulada),
            comandadoPor: i.creado_por_usuario_id,
          })),
        })),
      },
    });
  }
}
