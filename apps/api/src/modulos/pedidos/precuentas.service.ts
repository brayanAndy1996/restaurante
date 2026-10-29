import { Inject, Injectable } from '@nestjs/common';
import type { PrecuentaEntrada, PrecuentaRespuesta } from '@restaurante/contratos';
import { excedeMontoMaximo, totalOrden, totalVigenteLinea } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { MesasConsultaService } from '../salon';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import { idDeClienteReutilizado, montoFueraDeRango, ordenSinConsumo } from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { invalidarPrecuentaVigente } from './precuenta-invalidacion';

/** Nota de toda pre-cuenta (criterio 51, decisión 5). */
export const NOTA_PRECUENTA = 'Precios con IGV incluido. No es un comprobante de pago.';
/** Se agrega a la nota si algún ítem vigente lleva ICBPER (criterio 51). */
export const NOTA_ICBPER = 'El ICBPER se suma al cobrar.';

/**
 * Una línea de la pre-cuenta tal como se guarda en `precuenta.lineas` (jsonb): lo que sale en la respuesta más
 * `aplicaIcbper`, que solo sirve para armar la nota y no se devuelve.
 */
interface LineaGuardada {
  itemId: string;
  nombre: string;
  modificadores: string[];
  cantidad: number;
  precioUnitario: string;
  total: string;
  aplicaIcbper: boolean;
}

interface FilaPrecuenta {
  id: string;
  orden_id: string;
  numero: number;
  lineas: LineaGuardada[];
  total: string;
  emitida_en: Date;
}

interface FilaItemVigente {
  id: string;
  nombre: string;
  cantidad: number;
  cantidad_anulada: number;
  precio_unitario: string;
  aplica_icbper: boolean;
  linea: { modificadores?: { nombre: string }[] };
}

const COLUMNAS = 'id, orden_id, numero, lineas, total, emitida_en';

/**
 * Pre-cuenta (historia 004, criterios 50 a 54). Bloquea la orden (serializa los envíos, las anulaciones, las
 * uniones y las pre-cuentas de la misma orden), reconoce la réplica por el id de la pre-cuenta, devuelve la
 * vigente si no cambió nada desde que se emitió y, si no, emite la siguiente con su número. El total sale de
 * `totalOrden` de `packages/dominio`, con IGV incluido y sin desglose (decisión 5). Emitir deja la orden
 * `EN_PRECUENTA`; toda escritura que cambia los ítems la invalida y la devuelve a `ABIERTA` (criterio 53).
 */
@Injectable()
export class PrecuentasService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
  ) {}

  async emitir(ordenId: string, entrada: PrecuentaEntrada): Promise<PrecuentaRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const precuentaId = entrada.id.toLowerCase();

    const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);

    // Réplica por el id (criterio 52): antes del estado de la orden, así una réplica después de que la orden
    // cambió devuelve la pre-cuenta tal como se emitió. El mismo id en otra orden no es una réplica.
    const previa = await this.buscarPorId(precuentaId);
    if (previa !== undefined) {
      if (previa.orden_id !== orden.id) throw idDeClienteReutilizado();
      return this.armar(previa, orden.id, sucursalId);
    }
    exigirOrdenAbierta(orden);

    // La vigente sin cambios (criterio 52): toda escritura que cambia los ítems la invalida, y además se compara
    // su versión con la de la orden: si no coincide (algo cambió sin invalidarla) ya no vale y se emite la siguiente.
    const [vigente] = await this.conexion.query<FilaPrecuenta & { version_orden: number }>(
      `SELECT ${COLUMNAS}, version_orden FROM precuenta WHERE orden_id = $1 AND invalidada_en IS NULL`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const [actual] = await this.conexion.query<{ version: number }>(
      'SELECT version FROM orden WHERE id = $1',
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const versionActual = actual!.version;
    if (vigente !== undefined && vigente.version_orden === versionActual) {
      return this.armar(vigente, orden.id, sucursalId);
    }
    const ahora = this.reloj.ahora();
    if (vigente !== undefined) await invalidarPrecuentaVigente(this.conexion, orden.id, ahora);

    const items = await this.conexion.query<FilaItemVigente>(
      `SELECT i.id, i.nombre, i.cantidad, i.cantidad_anulada, i.precio_unitario, i.aplica_icbper, i.linea
         FROM item i JOIN envio e ON e.id = i.envio_id AND e.empresa_id = i.empresa_id
        WHERE i.orden_id = $1 AND i.cantidad_anulada < i.cantidad
        ORDER BY e.numero, i.posicion, i.id`,
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    if (items.length === 0) throw ordenSinConsumo();

    const lineas: LineaGuardada[] = items.map((i) => ({
      itemId: i.id,
      nombre: i.nombre,
      modificadores: (i.linea.modificadores ?? []).map((m) => m.nombre),
      cantidad: i.cantidad - i.cantidad_anulada,
      precioUnitario: i.precio_unitario,
      total: totalVigenteLinea(i.precio_unitario, i.cantidad, i.cantidad_anulada),
      aplicaIcbper: i.aplica_icbper,
    }));
    const total = totalOrden(
      items.map((i) => ({
        precioUnitario: i.precio_unitario,
        cantidad: i.cantidad,
        cantidadAnulada: i.cantidad_anulada,
      })),
    );
    // No debería pasar: el envío ya impide que el total de la orden pase el tope (criterio 21).
    if (excedeMontoMaximo(total)) {
      throw montoFueraDeRango([{ campo: 'total', mensaje: 'El total supera el máximo permitido' }]);
    }

    const [datos] = await this.conexion.query<{ numero: number }>(
      'SELECT coalesce(max(numero), 0) + 1 AS numero FROM precuenta WHERE orden_id = $1',
      { bind: [orden.id], type: QueryTypes.SELECT },
    );
    const insertada = await this.conexion.query<FilaPrecuenta>(
      `INSERT INTO precuenta (id, empresa_id, orden_id, numero, lineas, total, emitida_en, version_orden,
                              creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::numeric, $7, $8, $7, $7)
       ON CONFLICT (empresa_id, id) DO NOTHING
       RETURNING ${COLUMNAS}`,
      {
        bind: [
          precuentaId,
          empresaId,
          orden.id,
          datos!.numero,
          JSON.stringify(lineas),
          total,
          ahora,
          versionActual,
        ],
        type: QueryTypes.SELECT,
      },
    );
    // El mismo id lo guardó otra petición de otra orden mientras esta esperaba: no es una réplica.
    const nueva = insertada[0];
    if (nueva === undefined) throw idDeClienteReutilizado();

    await this.conexion.query(
      `UPDATE orden SET estado = 'EN_PRECUENTA', actualizado_en = $2 WHERE id = $1`,
      { bind: [orden.id, ahora], type: QueryTypes.UPDATE },
    );

    const mesaIds = await mesasVigentesDeOrden(this.conexion, orden.id);
    this.eventos.salonCambio(sucursalId, orden.id, mesaIds);
    this.eventos.ordenCambio(sucursalId, orden.id);
    return this.armar(nueva, orden.id, sucursalId);
  }

  private async buscarPorId(id: string): Promise<FilaPrecuenta | undefined> {
    const filas = await this.conexion.query<FilaPrecuenta>(
      `SELECT ${COLUMNAS} FROM precuenta WHERE id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    return filas[0];
  }

  /**
   * `precuentaRespuesta` de una pre-cuenta guardada: sus líneas, su total y su número tal como se emitieron, con
   * las mesas, el mozo y los comensales de la orden como están ahora (mover no la invalida). La nota sale de las
   * líneas guardadas.
   */
  private async armar(
    fila: FilaPrecuenta,
    ordenId: string,
    sucursalId: string,
  ): Promise<PrecuentaRespuesta> {
    const [orden] = await this.conexion.query<{ mozo_id: string | null; comensales: number }>(
      'SELECT mozo_id, comensales FROM orden WHERE id = $1 AND sucursal_id = $2',
      { bind: [ordenId, sucursalId], type: QueryTypes.SELECT },
    );
    const mesaIds = await mesasVigentesDeOrden(this.conexion, ordenId);
    const nombresMesas = await this.mesas.nombres(mesaIds);
    const mozoId = orden?.mozo_id ?? null;
    const nombresPersonas = await this.usuarios.nombres(mozoId === null ? [] : [mozoId]);
    const conIcbper = fila.lineas.some((l) => l.aplicaIcbper);
    return {
      id: fila.id,
      numero: fila.numero,
      emitidaEn: new Date(fila.emitida_en).toISOString(),
      orden: {
        id: ordenId,
        mesas: mesaIds.map((id) => ({ id, nombre: nombresMesas.get(id) ?? '' })),
        mozo: {
          id: mozoId ?? '',
          nombre: mozoId === null ? '' : (nombresPersonas.get(mozoId) ?? ''),
        },
        comensales: orden?.comensales ?? 0,
      },
      lineas: fila.lineas.map((l) => ({
        itemId: l.itemId,
        nombre: l.nombre,
        modificadores: l.modificadores,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        total: l.total,
      })),
      total: fila.total,
      nota: conIcbper ? `${NOTA_PRECUENTA} ${NOTA_ICBPER}` : NOTA_PRECUENTA,
    };
  }
}
