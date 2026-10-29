import { Inject, Injectable } from '@nestjs/common';
import type { CocinaRespuesta, ComandaKds, LineaKds } from '@restaurante/contratos';
import {
  transicionKdsValida,
  type EstadoLineaElegible,
  type EstadoLineaKds,
  type TipoComanda,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CartaConsultaService } from '../carta';
import { MesasConsultaService } from '../salon';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import {
  comandaNoEncontrada,
  lineaDeComandaNoEncontrada,
  transicionInvalida,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';

/** Cuántos minutos hacia atrás llegan las comandas "recientes" (criterio 56). */
const MINUTOS_RECIENTES = 60;
/** Cuántas comandas "recientes" se devuelven como máximo (criterio 56). */
const MAXIMO_RECIENTES = 30;

interface FilaComanda {
  id: string;
  tipo: TipoComanda;
  estacion_id: string;
  orden_id: string;
  origen_id: string | null;
  creado_en: Date;
  vista_en: Date | null;
  /** El motivo de la anulación de la que sale una comanda `ANULACION`; `null` en las demás. */
  motivo: string | null;
}

interface FilaLinea {
  id: string;
  comanda_id: string;
  item_id: string;
  rol: LineaKds['rol'];
  nombre: string;
  contexto: string | null;
  cantidad: number;
  modificadores: unknown;
  observacion: string | null;
  tiempo: LineaKds['tiempo'];
  esperar: boolean;
  para_llevar: boolean;
  estado: EstadoLineaKds;
}

interface FilaOrdenDeComanda {
  origen_id: string;
  id: string;
  mozo_id: string | null;
  comensales: number;
  mesa_ids: string[];
}

interface FilaAviso {
  item_id: string;
  orden_id: string;
  mozo_id: string | null;
  comandado_por: string | null;
}

/**
 * Las columnas de una comanda tal como la lee el KDS, con el motivo de su anulación (criterio 38) unido en la misma
 * consulta (`UNIR_MOTIVO`): ninguna consulta aparte según haya o no anulaciones.
 */
const COLUMNAS_COMANDA = `c.id, c.tipo, c.estacion_id, c.orden_id, c.origen_id, c.creado_en, c.vista_en,
       a.motivo AS motivo`;
const UNIR_MOTIVO = `LEFT JOIN anulacion_item a
         ON a.id = c.origen_id AND a.empresa_id = c.empresa_id AND c.tipo = 'ANULACION'`;

/** Las líneas de una comanda que todavía no se terminan (las que tiene el índice parcial). */
const LINEA_SIN_TERMINAR = `l.estado IN ('ENVIADO', 'EN_PREPARACION')`;

/**
 * Las que no están pendientes (criterio 56): una `MARCHAR` o `ANULACION` ya vista, o una `COMANDA` o `ADICION` sin
 * líneas por terminar. Las pendientes se piden aparte, en dos consultas (ver `comandas`).
 */
const SIN_PENDIENTES = `((c.tipo IN ('MARCHAR', 'ANULACION') AND c.vista_en IS NOT NULL)
         OR (c.tipo IN ('COMANDA', 'ADICION')
             AND NOT EXISTS (SELECT 1 FROM comanda_linea l
                              WHERE l.comanda_id = c.id AND l.empresa_id = c.empresa_id
                                AND ${LINEA_SIN_TERMINAR})))`;

/** Los tipos de comanda cuyas líneas se preparan y se marcan "Listo" (las demás se marcan vistas). */
const TIPOS_PREPARABLES: readonly TipoComanda[] = ['COMANDA', 'ADICION'];

/**
 * Las pantallas de cocina y barra (KDS; historia 004, criterios 56 a 63). Todo corre en la transacción de la
 * petición con la sucursal activa de la sesión: una comanda o una línea de otra sucursal, de otra empresa, de una
 * estación con impresora (destino `IMPRESORA`, criterio 61) o inexistente responde el mismo 404.
 *
 * `GET /cocina/comandas` se arma con una cantidad fija de consultas sin importar cuántas comandas haya: las
 * estaciones (`CartaConsultaService`), las pendientes (dos consultas), las recientes, sus líneas con la cantidad vigente del ítem,
 * las órdenes con sus mesas vigentes, los nombres de las mesas y los de las personas. El motivo de una anulación
 * viene unido a la consulta de las comandas. Las pendientes salen de índices parciales y las recientes se miden
 * por su última actividad (`greatest(creado_en, vista_en, max(comanda_linea.estado_en))`): ninguna recorre el
 * historial de la sucursal.
 *
 * Los eventos (`cocina.linea`, `cocina.listo`, `cocina.visto`) se registran con `alConfirmar` y salen solo si la transacción se
 * confirma y algo cambió: repetir un estado o marcar listo lo que ya estaba listo no publica nada.
 */
@Injectable()
export class CocinaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(CartaConsultaService) private readonly carta: CartaConsultaService,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
  ) {}

  // -------------------------------------------------------------------------------------------------
  // Leer (criterios 56, 57, 61 y 62)
  // -------------------------------------------------------------------------------------------------

  /**
   * `GET /cocina/comandas`. Sin `estacionIds`, las estaciones activas de la empresa; con ellos, solo esas (una de
   * otra empresa o inexistente no trae nada). `paraEtag` es la respuesta sin `ahora`, que cambia en cada petición.
   */
  async comandas(estacionIds: readonly string[]): Promise<{
    respuesta: CocinaRespuesta;
    paraEtag: Omit<CocinaRespuesta, 'ahora'>;
  }> {
    const sucursalId = this.sesion.sucursalActiva();
    const ahora = this.reloj.ahora();

    let ids: string[];
    let nombresEstaciones: Map<string, string>;
    if (estacionIds.length === 0) {
      const activas = await this.carta.estaciones();
      ids = activas.map((e) => e.id);
      nombresEstaciones = new Map(activas.map((e) => [e.id, e.nombre]));
    } else {
      ids = [...new Set(estacionIds.map((id) => id.toLowerCase()))];
      nombresEstaciones = await this.carta.nombres(ids);
    }

    const desde = new Date(ahora.getTime() - MINUTOS_RECIENTES * 60_000);
    // Las pendientes, en dos consultas que el planificador resuelve por los índices parciales (una sola con `OR` o
    // `UNION` lo lleva a recorrer las comandas de la sucursal, porque no sabe que `tipo` y `vista_en` se
    // correlacionan): las de marcha o anulación todavía no vistas, y las comandas y adiciones con alguna línea por
    // terminar (de ahí se llega a la comanda por su llave).
    const noVistas = await this.conexion.query<FilaComanda>(
      `SELECT ${COLUMNAS_COMANDA}
         FROM comanda c ${UNIR_MOTIVO}
        WHERE c.sucursal_id = $1 AND c.destino = 'KDS' AND c.estacion_id = ANY($2::uuid[])
          AND c.tipo IN ('MARCHAR', 'ANULACION') AND c.vista_en IS NULL`,
      { bind: [sucursalId, ids], type: QueryTypes.SELECT },
    );
    const sinTerminar = await this.conexion.query<FilaComanda>(
      `SELECT ${COLUMNAS_COMANDA}
         FROM comanda c ${UNIR_MOTIVO}
        WHERE c.sucursal_id = $1 AND c.destino = 'KDS' AND c.estacion_id = ANY($2::uuid[])
          AND c.tipo IN ('COMANDA', 'ADICION')
          AND c.id IN (SELECT l.comanda_id FROM comanda_linea l WHERE ${LINEA_SIN_TERMINAR})`,
      { bind: [sucursalId, ids], type: QueryTypes.SELECT },
    );
    const pendientes = ordenarPorLlegada([...noVistas, ...sinTerminar]);
    // Las recientes: las demás, por su última actividad en la última hora (una comanda vieja que se termina ahora
    // aparece aquí y se puede corregir). Los candidatos salen de los instantes con índice; las 30 más recientes
    // se muestran en orden de llegada.
    const recientes = await this.conexion.query<FilaComanda>(
      `SELECT t.id, t.tipo, t.estacion_id, t.orden_id, t.origen_id, t.creado_en, t.vista_en, t.motivo
         FROM (SELECT ${COLUMNAS_COMANDA},
                      greatest(c.creado_en, c.vista_en,
                               (SELECT max(l.estado_en) FROM comanda_linea l
                                 WHERE l.comanda_id = c.id AND l.empresa_id = c.empresa_id)) AS actividad_en
                 FROM comanda c ${UNIR_MOTIVO}
                WHERE c.sucursal_id = $1 AND c.destino = 'KDS' AND c.estacion_id = ANY($2::uuid[])
                  AND c.id IN (
                        SELECT x.id FROM comanda x WHERE x.sucursal_id = $1 AND x.creado_en >= $3
                        UNION
                        SELECT x.id FROM comanda x WHERE x.sucursal_id = $1 AND x.vista_en >= $3
                        UNION
                        SELECT l.comanda_id FROM comanda_linea l WHERE l.estado_en >= $3)
                  AND ${SIN_PENDIENTES}) t
        WHERE t.actividad_en >= $3
        ORDER BY t.actividad_en DESC, t.creado_en DESC, t.id DESC
        LIMIT ${MAXIMO_RECIENTES}`,
      { bind: [sucursalId, ids, desde], type: QueryTypes.SELECT },
    );

    const enOrden = [...pendientes, ...ordenarPorLlegada(recientes)];
    const armadas = await this.armar(enOrden, nombresEstaciones);
    const paraEtag = {
      pendientes: armadas.slice(0, pendientes.length),
      recientes: armadas.slice(pendientes.length),
    };
    return { respuesta: { ...paraEtag, ahora: ahora.toISOString() }, paraEtag };
  }

  /** Arma las comandas con sus líneas, su orden (mesas, mozo y comensales) y su estación. */
  private async armar(
    filas: readonly FilaComanda[],
    nombresEstaciones: Map<string, string>,
  ): Promise<ComandaKds[]> {
    // Las consultas corren aunque no haya comandas: así el total no depende de los datos.
    const lineas = await this.lineas(filas.map((f) => f.id));
    // Si la orden de origen se unió a otra, la comanda se muestra con la orden en que quedó (sus mesas vigentes).
    const ordenes = await this.conexion.query<FilaOrdenDeComanda>(
      `WITH RECURSIVE cadena AS (
         SELECT o.id AS origen_id, o.id, o.empresa_id, o.unida_a_orden_id FROM orden o
          WHERE o.id = ANY($1::uuid[])
         UNION ALL
         SELECT c.origen_id, o.id, o.empresa_id, o.unida_a_orden_id
           FROM cadena c JOIN orden o ON o.id = c.unida_a_orden_id AND o.empresa_id = c.empresa_id
       )
       SELECT c.origen_id, o.id, o.mozo_id, o.comensales,
              coalesce((SELECT array_agg(om.mesa_id ORDER BY om.desde, om.id) FROM orden_mesa om
                         WHERE om.orden_id = o.id AND om.empresa_id = o.empresa_id AND om.hasta IS NULL),
                       '{}') AS mesa_ids
         FROM cadena c JOIN orden o ON o.id = c.id AND o.empresa_id = c.empresa_id
        WHERE c.unida_a_orden_id IS NULL`,
      { bind: [[...new Set(filas.map((f) => f.orden_id))]], type: QueryTypes.SELECT },
    );
    const ordenDe = new Map(ordenes.map((o) => [o.origen_id, o]));
    const nombresMesas = await this.mesas.nombres(ordenes.flatMap((o) => o.mesa_ids));
    const nombresPersonas = await this.usuarios.nombres(
      ordenes.flatMap((o) => (o.mozo_id === null ? [] : [o.mozo_id])),
    );

    const lineasDe = new Map<string, LineaKds[]>();
    for (const l of lineas) {
      const lista = lineasDe.get(l.comandaId) ?? [];
      lista.push(l.linea);
      lineasDe.set(l.comandaId, lista);
    }
    return filas.map((f): ComandaKds => {
      const orden = ordenDe.get(f.orden_id);
      return {
        id: f.id,
        tipo: f.tipo,
        creadaEn: new Date(f.creado_en).toISOString(),
        vistaEn: f.vista_en === null ? null : new Date(f.vista_en).toISOString(),
        motivo: f.motivo,
        estacion: { id: f.estacion_id, nombre: nombresEstaciones.get(f.estacion_id) ?? '' },
        orden: {
          id: orden?.id ?? f.orden_id,
          mesas: (orden?.mesa_ids ?? []).map((id) => ({ id, nombre: nombresMesas.get(id) ?? '' })),
          mozo: {
            id: orden?.mozo_id ?? '',
            nombre: nombresPersonas.get(orden?.mozo_id ?? '') ?? '',
          },
          comensales: orden?.comensales ?? 0,
        },
        lineas: lineasDe.get(f.id) ?? [],
      };
    });
  }

  // -------------------------------------------------------------------------------------------------
  // Cambiar el estado de una línea (criterios 58 y 60)
  // -------------------------------------------------------------------------------------------------

  /**
   * `PUT /cocina/lineas/:id/estado`: bloquea la línea y la cambia si la transición es válida (`transicionKdsValida`).
   * Repetir el estado actual responde 200 sin evento; una línea `ANULADO`, o la de una comanda `MARCHAR` o
   * `ANULACION` (que solo se marcan vistas), 409 `TRANSICION_INVALIDA`. Al pasar a `LISTO` avisa a quien
   * corresponde (`cocina.listo`).
   */
  async cambiarEstado(lineaId: string, hacia: EstadoLineaElegible): Promise<LineaKds> {
    const sucursalId = this.sesion.sucursalActiva();
    const filas = await this.conexion.query<{
      id: string;
      comanda_id: string;
      estado: EstadoLineaKds;
      tipo: TipoComanda;
    }>(
      `SELECT cl.id, cl.comanda_id, cl.estado, c.tipo
         FROM comanda_linea cl
         JOIN comanda c ON c.id = cl.comanda_id AND c.empresa_id = cl.empresa_id
        WHERE cl.id = $1 AND c.sucursal_id = $2 AND c.destino = 'KDS'
          FOR UPDATE OF cl`,
      { bind: [lineaId, sucursalId], type: QueryTypes.SELECT },
    );
    const linea = filas[0];
    if (linea === undefined) throw lineaDeComandaNoEncontrada();
    if (!TIPOS_PREPARABLES.includes(linea.tipo)) {
      throw transicionInvalida('Las comandas de marcha y de anulación solo se marcan como vistas');
    }
    if (!transicionKdsValida(linea.estado, hacia)) {
      throw transicionInvalida('Una línea anulada no cambia de estado');
    }
    const cambia = linea.estado !== hacia;
    if (cambia) {
      const ahora = this.reloj.ahora();
      await this.conexion.query(
        `UPDATE comanda_linea SET estado = $2, estado_en = $3, actualizado_en = $3 WHERE id = $1`,
        { bind: [linea.id, hacia, ahora] },
      );
    }
    const [vista] = await this.lineas([linea.comanda_id], [linea.id]);
    if (cambia) await this.publicarCambios(sucursalId, linea.comanda_id, [vista!.linea]);
    return vista!.linea;
  }

  // -------------------------------------------------------------------------------------------------
  // Todo listo y visto (criterio 59)
  // -------------------------------------------------------------------------------------------------

  /**
   * `PUT /cocina/comandas/:id/listo`: pone en `LISTO` todas las líneas no anuladas de una comanda `COMANDA` o
   * `ADICION`; otro tipo, 409 `TRANSICION_INVALIDA`. No toca las líneas que esperan la marcha (`esperar = true`,
   * ítems de segundo tiempo que todavía no se marcharon): siguen `ENVIADO` y no avisan; una vez marchado el ítem
   * (`esperar = false`), entran. Idempotente: solo avisa por las líneas que cambiaron.
   */
  async todoListo(comandaId: string): Promise<ComandaKds> {
    const sucursalId = this.sesion.sucursalActiva();
    const fila = await this.comandaDeLaSucursal(comandaId, sucursalId);
    if (!TIPOS_PREPARABLES.includes(fila.tipo)) {
      throw transicionInvalida('Solo las comandas y las adiciones se marcan como listas');
    }
    // Bloquea las líneas en orden de id: dos "Todo listo" a la vez no se cruzan.
    await this.conexion.query(
      `SELECT id FROM comanda_linea WHERE comanda_id = $1 ORDER BY id FOR UPDATE`,
      { bind: [fila.id], type: QueryTypes.SELECT },
    );
    const ahora = this.reloj.ahora();
    const cambiadas = await this.conexion.query<{ id: string }>(
      `UPDATE comanda_linea SET estado = 'LISTO', estado_en = $2, actualizado_en = $2
        WHERE comanda_id = $1 AND estado IN ('ENVIADO', 'EN_PREPARACION') AND esperar = false
        RETURNING id`,
      { bind: [fila.id, ahora], type: QueryTypes.SELECT },
    );
    if (cambiadas.length > 0) {
      const ids = new Set(cambiadas.map((c) => c.id));
      const lineas = await this.lineas([fila.id], [...ids]);
      await this.publicarCambios(
        sucursalId,
        fila.id,
        lineas.map((l) => l.linea),
      );
    }
    return this.comandaArmada(fila);
  }

  /**
   * `PUT /cocina/comandas/:id/visto`: marca como vista una comanda `MARCHAR` o `ANULACION` (sale de pendientes);
   * otro tipo, 409 `TRANSICION_INVALIDA`. Repetirlo no cambia la fecha en que se vio ni publica nada; la primera
   * vez publica `cocina.visto` para que los demás KDS la saquen de pendientes.
   */
  async visto(comandaId: string): Promise<ComandaKds> {
    const sucursalId = this.sesion.sucursalActiva();
    const fila = await this.comandaDeLaSucursal(comandaId, sucursalId);
    if (TIPOS_PREPARABLES.includes(fila.tipo)) {
      throw transicionInvalida('Solo las comandas de marcha y de anulación se marcan como vistas');
    }
    if (fila.vista_en === null) {
      const ahora = this.reloj.ahora();
      await this.conexion.query(
        `UPDATE comanda SET vista_en = $2, actualizado_en = $2 WHERE id = $1 AND vista_en IS NULL`,
        { bind: [fila.id, ahora] },
      );
      this.eventos.cocinaVisto(sucursalId, fila.id);
    }
    return this.comandaArmada(fila);
  }

  // -------------------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------------------

  private async comandaDeLaSucursal(comandaId: string, sucursalId: string): Promise<FilaComanda> {
    const filas = await this.conexion.query<FilaComanda>(
      `SELECT ${COLUMNAS_COMANDA}
         FROM comanda c ${UNIR_MOTIVO}
        WHERE c.id = $1 AND c.sucursal_id = $2 AND c.destino = 'KDS'
          FOR UPDATE OF c`,
      { bind: [comandaId, sucursalId], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw comandaNoEncontrada();
    return filas[0];
  }

  /** La comanda tal como está ahora (después de los cambios de la petición). */
  private async comandaArmada(fila: FilaComanda): Promise<ComandaKds> {
    const [actual] = await this.conexion.query<FilaComanda>(
      `SELECT ${COLUMNAS_COMANDA} FROM comanda c ${UNIR_MOTIVO} WHERE c.id = $1`,
      { bind: [fila.id], type: QueryTypes.SELECT },
    );
    const nombres = await this.carta.nombres([fila.estacion_id]);
    const [armada] = await this.armar([actual ?? fila], nombres);
    return armada!;
  }

  /**
   * Las líneas de las comandas pedidas (o solo las `lineaIds`), con la misma forma que en `GET`: la única consulta
   * de líneas del KDS. La cantidad vigente es la fija de la línea (marcha y anulación) o la del ítem por la de la
   * parte; las columnas son `integer`, así que `99 × 999` no desborda.
   */
  private async lineas(
    comandaIds: readonly string[],
    lineaIds?: readonly string[],
  ): Promise<{ comandaId: string; linea: LineaKds }[]> {
    const filas = await this.conexion.query<FilaLinea>(
      `SELECT cl.id, cl.comanda_id, cl.item_id, cl.rol, cl.nombre, cl.contexto,
              coalesce(cl.cantidad, cl.cantidad_por_item * (i.cantidad - i.cantidad_anulada)) AS cantidad,
              cl.modificadores, cl.observacion, cl.tiempo, cl.esperar, cl.para_llevar, cl.estado
         FROM comanda_linea cl
         JOIN item i ON i.id = cl.item_id AND i.empresa_id = cl.empresa_id
        WHERE cl.comanda_id = ANY($1::uuid[]) AND ($2::uuid[] IS NULL OR cl.id = ANY($2::uuid[]))
        ORDER BY i.creado_en, i.posicion, i.id,
                 CASE cl.rol WHEN 'PRODUCTO' THEN 0 WHEN 'COMPONENTE' THEN 1 ELSE 2 END, cl.nombre, cl.id`,
      {
        bind: [[...comandaIds], lineaIds === undefined ? null : [...lineaIds]],
        type: QueryTypes.SELECT,
      },
    );
    return filas.map((f) => ({ comandaId: f.comanda_id, linea: aLinea(f) }));
  }

  /**
   * Registra los eventos de las líneas que cambiaron de estado: `cocina.linea` por cada una y, por cada una que
   * quedó en `LISTO`, `cocina.listo` con el mozo responsable de la orden vigente del ítem y quien comandó el ítem
   * (sin repetir). Corre dentro de la transacción; los eventos salen al confirmarla.
   */
  private async publicarCambios(
    sucursalId: string,
    comandaId: string,
    lineas: readonly LineaKds[],
  ): Promise<void> {
    for (const l of lineas) {
      this.eventos.cocinaLinea(sucursalId, { comandaId, lineaId: l.id, estado: l.estado });
    }
    const listas = lineas.filter((l) => l.estado === 'LISTO');
    if (listas.length === 0) return;

    const avisos = await this.conexion.query<FilaAviso>(
      `SELECT i.id AS item_id, i.orden_id, o.mozo_id, i.creado_por_usuario_id AS comandado_por
         FROM item i JOIN orden o ON o.id = i.orden_id AND o.empresa_id = i.empresa_id
        WHERE i.id = ANY($1::uuid[])`,
      { bind: [[...new Set(listas.map((l) => l.itemId))]], type: QueryTypes.SELECT },
    );
    const mesasVigentes = await this.conexion.query<{ orden_id: string; mesa_id: string }>(
      `SELECT orden_id, mesa_id FROM orden_mesa
        WHERE orden_id = ANY($1::uuid[]) AND hasta IS NULL ORDER BY desde, id`,
      { bind: [[...new Set(avisos.map((a) => a.orden_id))]], type: QueryTypes.SELECT },
    );
    const nombresMesas = await this.mesas.nombres(mesasVigentes.map((m) => m.mesa_id));
    const avisoDe = new Map(avisos.map((a) => [a.item_id, a]));
    for (const l of listas) {
      const aviso = avisoDe.get(l.itemId);
      if (aviso === undefined) continue;
      const destinatarios = [
        ...new Set([aviso.mozo_id, aviso.comandado_por].filter((id): id is string => id !== null)),
      ];
      this.eventos.cocinaListo(sucursalId, {
        ordenId: aviso.orden_id,
        itemId: l.itemId,
        lineaId: l.id,
        mesas: mesasVigentes
          .filter((m) => m.orden_id === aviso.orden_id)
          .map((m) => ({ id: m.mesa_id, nombre: nombresMesas.get(m.mesa_id) ?? '' })),
        nombre: l.nombre,
        cantidad: l.cantidad,
        destinatarios,
      });
    }
  }
}

/** En orden de llegada: `creado_en` y, a igual instante, el id (criterio 56). */
function ordenarPorLlegada(filas: readonly FilaComanda[]): FilaComanda[] {
  return [...filas].sort((a, b) => {
    const dif = new Date(a.creado_en).getTime() - new Date(b.creado_en).getTime();
    if (dif !== 0) return dif;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function aLinea(f: FilaLinea): LineaKds {
  return {
    id: f.id,
    itemId: f.item_id,
    rol: f.rol,
    nombre: f.nombre,
    contexto: f.contexto,
    cantidad: f.cantidad,
    modificadores: Array.isArray(f.modificadores)
      ? f.modificadores.filter((m): m is string => typeof m === 'string')
      : [],
    observacion: f.observacion,
    tiempo: f.tiempo,
    esperar: f.esperar,
    paraLlevar: f.para_llevar,
    estado: f.estado,
  };
}
