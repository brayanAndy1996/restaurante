import { Inject, Injectable } from '@nestjs/common';
import type {
  CortesiaRespuesta,
  DescuentoRespuesta,
  EnvioRespuesta,
  LineaEnvioEntradaValidada,
} from '@restaurante/contratos';
import {
  diaOperativo,
  type AfectacionIgv,
  type EstadoOrden,
  type ModoCobro,
  type TipoOrden,
  type TipoParte,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { conMontosConsistentes } from '../../nucleo/errores/montos-inconsistentes';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { SucursalesConsultaService } from '../plataforma';
import { MesasConsultaService } from '../salon';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import { bloquearOrden, exigirOrdenAbierta } from './bloqueos-orden';
import {
  cuentaDeDatos,
  descuentoQueNoSeAdmite,
  leerDatosDeCuentas,
  personasDeCuenta,
  respuestasDeCuenta,
  type DatosDeCuenta,
} from './cuenta-de-orden';
import { EnviosService } from './envios.service';
import {
  idDeClienteReutilizado,
  montosInconsistentes,
  operacionConcurrente,
  ordenNoEncontrada,
} from './errores-pedidos';
import { EventosPedidos } from './eventos-pedidos';
import { LlamadosMostrador } from './llamados-mostrador';
import { mesasVigentesDeOrden } from './mesas-de-orden';
import { invalidarPrecuentaVigente } from './precuenta-invalidacion';
import { VistaOrdenService } from './vista-orden';

/**
 * Lo que la caja necesita de las órdenes (historia 006, "Interfaces de la API"). Pedidos es dueño de las órdenes, los
 * ítems, los descuentos, las cortesías y el número de llamado; el módulo de caja las cobra por este servicio y nunca
 * consulta esas tablas. Todo corre en la transacción de la empresa del contexto activo. FIRMAS de la fase A.
 */

/** Una línea de la cuenta tal como la guarda pedidos: un ítem con su cantidad vigente. */
export interface LineaParaCobrar {
  itemId: string;
  nombre: string;
  /** Nombres de los modificadores elegidos (su precio extra ya está en `precioUnitario`). */
  modificadores: string[];
  precioUnitario: string;
  /** La cantidad vigente (la enviada menos la anulada). */
  cantidad: number;
  /** Unidades en cortesía vigente. */
  cantidadCortesia: number;
  /** Unidades ya cobradas en partes anteriores. */
  cantidadFacturada: number;
  afectacion: AfectacionIgv;
  aplicaIcbper: boolean;
  /** El descuento vigente de este ítem. */
  descuento: DescuentoRespuesta | null;
}

/** La cuenta de una orden vista para cobrar. */
export interface CuentaParaCobrar {
  ordenId: string;
  sucursalId: string;
  tipo: TipoOrden;
  estado: EstadoOrden;
  mesas: { id: string; nombre: string }[];
  /** `null` en la venta de mostrador. */
  mozo: { id: string; nombre: string } | null;
  numeroLlamado: number | null;
  /** Sube con todo lo que cambia la cuenta (envíos, anulaciones, uniones, descuentos, cortesías y cobros). */
  version: number;
  lineas: LineaParaCobrar[];
  descuentoCuenta: DescuentoRespuesta | null;
  cortesias: CortesiaRespuesta[];
  /** Suma de lo cobrado en partes anteriores (`orden.monto_cobrado`). */
  cobrado: string;
  /** El ICBPER de lo ya cobrado (`orden.icbper_cobrado`, criterio 89). */
  icbperCobrado: string;
  /** Cantidad de cobros de la orden (`orden.cobros`). */
  cobros: number;
  modo: ModoCobro | null;
  abiertaEn: Date;
}

/** Lo que la caja anota en la orden al cobrar una parte (criterios 52 y 53). */
export interface CobroParaRegistrar {
  ordenId: string;
  /** Unidades cobradas por ítem en esta parte (el `porItem` de la parte; suma `item.cantidad_facturada`). */
  itemsFacturados: readonly { itemId: string; cantidad: number }[];
  /** El total de la parte, con su ICBPER (suma `orden.monto_cobrado`). */
  monto: string;
  /** El ICBPER de la parte (suma `orden.icbper_cobrado`, para el `porPagar` de la pre-cuenta, criterio 89). */
  icbper: string;
  /** El tipo de la parte: fija `orden.modo_cobro` con `ITEMS` o `IGUALES`; `TOTAL` no lo cambia. */
  tipo: TipoParte;
  /** `true` si con esta parte no falta nada: la orden queda `CERRADA` y las mesas, libres. */
  cierraLaCuenta: boolean;
  /** El instante del cobro (reloj de la API). */
  ahora: Date;
}

export interface EstadoDeCuentaTrasCobro {
  estado: EstadoOrden;
  version: number;
}

/** La venta de mostrador que pedidos abre y envía (criterio 80). */
export interface MostradorParaAbrir {
  /** El `id` de la venta: es el de la orden. */
  id: string;
  lineas: readonly LineaEnvioEntradaValidada[];
}

export interface MostradorAbierto {
  ordenId: string;
  numeroLlamado: number;
  envio: EnvioRespuesta;
}

interface FilaOrdenDeCuenta {
  id: string;
  sucursal_id: string;
  tipo: TipoOrden;
  estado: EstadoOrden;
  mozo_id: string | null;
  numero_llamado: number | null;
  version: number;
  abierta_en: Date;
  monto_cobrado: string;
  icbper_cobrado: string;
  cobros: number;
  modo_cobro: ModoCobro | null;
  unida_a_orden_id: string | null;
}

const COLUMNAS_ORDEN = `id, sucursal_id, tipo, estado, mozo_id, numero_llamado, version, abierta_en,
       monto_cobrado::text AS monto_cobrado, icbper_cobrado::text AS icbper_cobrado, cobros, modo_cobro,
       unida_a_orden_id`;

@Injectable()
export class CuentasDePedidos {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(MesasConsultaService) private readonly mesas: MesasConsultaService,
    @Inject(EventosPedidos) private readonly eventos: EventosPedidos,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(LlamadosMostrador) private readonly llamados: LlamadosMostrador,
    @Inject(EnviosService) private readonly envios: EnviosService,
    @Inject(VistaOrdenService) private readonly vista: VistaOrdenService,
  ) {}

  /**
   * La cuenta de la orden. Con `bloquear`, la toma con `FOR UPDATE` (el mismo bloqueo que los envíos). 404 si es de
   * otra sucursal, de otra empresa o no existe; 409 `ORDEN_NO_ABIERTA` (con `ordenId` de la principal si está
   * `UNIDA`) salvo con `soloAbiertas: false`, que la devuelve en cualquier estado (la consulta de la cuenta).
   */
  async cuentaParaCobrar(
    ordenId: string,
    opciones: { bloquear: boolean; soloAbiertas?: boolean },
  ): Promise<CuentaParaCobrar> {
    const sucursalId = this.sesion.sucursalActiva();
    if (opciones.bloquear) {
      const orden = await bloquearOrden(this.conexion, ordenId, sucursalId);
      if (opciones.soloAbiertas !== false) exigirOrdenAbierta(orden);
    }
    const filas = await this.conexion.query<FilaOrdenDeCuenta>(
      `SELECT ${COLUMNAS_ORDEN} FROM orden WHERE id = $1 AND sucursal_id = $2`,
      { bind: [ordenId, sucursalId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) throw ordenNoEncontrada();
    if (!opciones.bloquear && opciones.soloAbiertas !== false) {
      exigirOrdenAbierta({
        id: fila.id,
        sucursalId: fila.sucursal_id,
        estado: fila.estado,
        comensales: 0,
        unidaA: fila.unida_a_orden_id,
        cobros: fila.cobros,
      });
    }
    return (await this.armar([fila]))[0]!;
  }

  /** Las órdenes abiertas de la sucursal activa con su cuenta, de la más antigua a la más nueva. */
  async cuentasAbiertas(): Promise<CuentaParaCobrar[]> {
    const sucursalId = this.sesion.sucursalActiva();
    const filas = await this.conexion.query<FilaOrdenDeCuenta>(
      `SELECT ${COLUMNAS_ORDEN} FROM orden
        WHERE sucursal_id = $1 AND estado IN ('ABIERTA', 'EN_PRECUENTA')
        ORDER BY abierta_en, creado_en, id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return this.armar(filas);
  }

  /** Arma las cuentas de varias órdenes con un número fijo de consultas. */
  private async armar(filas: readonly FilaOrdenDeCuenta[]): Promise<CuentaParaCobrar[]> {
    const ids = filas.map((f) => f.id);
    const datos = await leerDatosDeCuentas(this.conexion, ids);
    const vigentes = await this.conexion.query<{ orden_id: string; mesa_id: string }>(
      `SELECT orden_id, mesa_id FROM orden_mesa
        WHERE orden_id = ANY($1::uuid[]) AND hasta IS NULL ORDER BY desde, id`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    const nombresMesas = await this.mesas.nombres(vigentes.map((v) => v.mesa_id));
    const personas = [
      ...filas.flatMap((f) => (f.mozo_id === null ? [] : [f.mozo_id])),
      ...[...datos.values()].flatMap((d: DatosDeCuenta) => personasDeCuenta(d)),
    ];
    const nombres = await this.usuarios.nombres(personas);

    return filas.map((fila) => {
      const cuenta = datos.get(fila.id)!;
      // Criterio 45a: ninguna ruta responde 500 por un `RangeError` de `calcularCuenta`. Las escrituras no dejan una
      // cuenta así (cada una valida antes); si una lectura sin bloqueo vio las tablas en instantes distintos de una
      // escritura en curso, es un 409 que se repite.
      // Cualquier otro `RangeError` de los montos (un cobrado que pasa de la cuenta, un monto fuera de rango) es
      // también un 409, con el detalle en el log.
      const respuestas = conMontosConsistentes(
        `la cuenta de la orden ${fila.id}`,
        montosInconsistentes,
        () => {
          if (descuentoQueNoSeAdmite(cuentaDeDatos(cuenta))) throw operacionConcurrente();
          return respuestasDeCuenta(cuenta, nombres);
        },
      );
      return {
        ordenId: fila.id,
        sucursalId: fila.sucursal_id,
        tipo: fila.tipo,
        estado: fila.estado,
        mesas: vigentes
          .filter((v) => v.orden_id === fila.id)
          .map((v) => ({ id: v.mesa_id, nombre: nombresMesas.get(v.mesa_id) ?? '' })),
        mozo:
          fila.mozo_id === null
            ? null
            : { id: fila.mozo_id, nombre: nombres.get(fila.mozo_id) ?? '' },
        numeroLlamado: fila.numero_llamado,
        version: fila.version,
        lineas: cuenta.items.map((i) => ({
          itemId: i.id,
          nombre: i.nombre,
          modificadores: i.modificadores,
          precioUnitario: i.precioUnitario,
          cantidad: i.cantidad,
          cantidadCortesia: Math.min(
            cuenta.cortesias.find((c) => c.itemId === i.id)?.cantidad ?? 0,
            i.cantidad,
          ),
          cantidadFacturada: i.cantidadFacturada,
          afectacion: i.afectacion,
          aplicaIcbper: i.aplicaIcbper,
          descuento: respuestas.descuentoDeItem.get(i.id) ?? null,
        })),
        descuentoCuenta: respuestas.descuentoCuenta,
        cortesias: respuestas.cortesias,
        cobrado: fila.monto_cobrado,
        icbperCobrado: fila.icbper_cobrado,
        cobros: fila.cobros,
        modo: fila.modo_cobro,
        abiertaEn: new Date(fila.abierta_en),
      };
    });
  }

  /**
   * Suma lo facturado y lo cobrado, fija el modo, sube la versión y, si `cierraLaCuenta`, deja la orden `CERRADA`,
   * cierra `orden_mesa` y registra `salon.cambio` y `orden.cambio` con `alConfirmar` (criterios 52 y 53). La orden ya
   * debe estar bloqueada por quien cobra (`cuentaParaCobrar` con `bloquear`). Un cobro parcial no invalida la
   * pre-cuenta ni la saca de `EN_PRECUENTA`; el que cierra la cuenta sí la invalida (ya no hay nada que cobrar).
   */
  async registrarCobro(cobro: CobroParaRegistrar): Promise<EstadoDeCuentaTrasCobro> {
    const [antes] = await this.conexion.query<{ sucursal_id: string; estado: EstadoOrden }>(
      'SELECT sucursal_id, estado FROM orden WHERE id = $1',
      { bind: [cobro.ordenId], type: QueryTypes.SELECT },
    );
    if (antes === undefined) throw ordenNoEncontrada();
    const mesaIds = cobro.cierraLaCuenta
      ? await mesasVigentesDeOrden(this.conexion, cobro.ordenId)
      : [];

    if (cobro.itemsFacturados.length > 0) {
      await this.conexion.query(
        `UPDATE item i
            SET cantidad_facturada = i.cantidad_facturada + x.cantidad, actualizado_en = $3
           FROM jsonb_to_recordset($1::jsonb) AS x(item_id uuid, cantidad int)
          WHERE i.id = x.item_id AND i.orden_id = $2`,
        {
          bind: [
            JSON.stringify(
              cobro.itemsFacturados.map((i) => ({ item_id: i.itemId, cantidad: i.cantidad })),
            ),
            cobro.ordenId,
            cobro.ahora,
          ],
          type: QueryTypes.UPDATE,
        },
      );
    }
    const [despues] = await this.conexion.query<{ estado: EstadoOrden; version: number }>(
      `UPDATE orden
          SET monto_cobrado = monto_cobrado + $2::numeric,
              icbper_cobrado = icbper_cobrado + $3::numeric,
              cobros = cobros + 1,
              modo_cobro = CASE WHEN $4::text = 'IGUALES' THEN 'IGUALES'
                                WHEN $4::text = 'ITEMS' THEN coalesce(modo_cobro, 'ITEMS')
                                ELSE modo_cobro END,
              version = version + 1,
              estado = CASE WHEN $5::boolean THEN 'CERRADA' ELSE estado END,
              cerrada_en = CASE WHEN $5::boolean THEN $6::timestamptz ELSE cerrada_en END,
              actualizado_en = $6
        WHERE id = $1
        RETURNING estado, version`,
      {
        bind: [
          cobro.ordenId,
          cobro.monto,
          cobro.icbper,
          cobro.tipo,
          cobro.cierraLaCuenta,
          cobro.ahora,
        ],
        type: QueryTypes.SELECT,
      },
    );
    if (cobro.cierraLaCuenta) {
      await this.conexion.query(
        `UPDATE orden_mesa SET hasta = $2, actualizado_en = $2 WHERE orden_id = $1 AND hasta IS NULL`,
        { bind: [cobro.ordenId, cobro.ahora], type: QueryTypes.UPDATE },
      );
      if (antes.estado === 'EN_PRECUENTA') {
        await invalidarPrecuentaVigente(this.conexion, cobro.ordenId, cobro.ahora);
      }
      // La venta de mostrador no tiene mesas: no hay mapa que refrescar.
      if (mesaIds.length > 0) this.eventos.salonCambio(antes.sucursal_id, cobro.ordenId, mesaIds);
    }
    this.eventos.ordenCambio(antes.sucursal_id, cobro.ordenId);
    return { estado: despues!.estado, version: despues!.version };
  }

  /**
   * Crea la orden `MOSTRADOR` (canal `SALON`, sin mesa ni mozo, 1 comensal), toma su número de llamado y corre el
   * envío de 004 con sus validaciones, su puerto de inventario y sus comandas con el número de llamado
   * (criterios 80 a 82). Todo dentro de la transacción de quien llama: si algo lanza después (los pagos, el total, el
   * turno), la orden, el envío, las comandas, el número de llamado y la llamada al inventario se revierten juntos.
   * El `id` de la venta es el de la orden y el del envío; la réplica por `id` la resuelve quien llama antes de
   * abrir nada, así que un `id` que ya es de otra orden es 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
   */
  async abrirYEnviarMostrador(datos: MostradorParaAbrir): Promise<MostradorAbierto> {
    const sucursalId = this.sesion.sucursalActiva();
    const empresaId = this.contexto.empresaActual();
    const id = datos.id.toLowerCase();
    const ahora = this.reloj.ahora();
    const horaCorte = await this.sucursales.horaCorte(sucursalId);
    const dia = diaOperativo(ahora, horaCorte ?? '00:00');
    const numeroLlamado = await this.llamados.siguiente(sucursalId, dia);

    const insertada = await this.conexion.query<{ id: string }>(
      `INSERT INTO orden (id, empresa_id, sucursal_id, tipo, canal, estado, mozo_id, comensales, abierta_en,
                          sin_consumo, version, numero_llamado, dia_operativo_llamado, creado_en, actualizado_en)
       VALUES ($1, $2, $3, 'MOSTRADOR', 'SALON', 'ABIERTA', NULL, 1, $4, false, 1, $5, $6::date, $4, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      {
        bind: [id, empresaId, sucursalId, ahora, numeroLlamado, dia],
        type: QueryTypes.SELECT,
      },
    );
    // El `id` ya es de otra orden (de la empresa): no es una réplica de esta venta.
    if (insertada.length === 0) throw idDeClienteReutilizado();

    const envio = await this.envios.enviar(id, { id, lineas: [...datos.lineas] });
    return { ordenId: id, numeroLlamado, envio };
  }

  /**
   * La venta de mostrador ya hecha con ese `id`, tal como salió (la réplica, criterio 83): su número de llamado y su
   * envío. `undefined` si la orden no existe, no es de mostrador o es de otra sucursal.
   */
  async mostradorDe(ordenId: string): Promise<MostradorAbierto | undefined> {
    const sucursalId = this.sesion.sucursalActiva();
    const filas = await this.conexion.query<{ numero_llamado: number | null }>(
      `SELECT numero_llamado FROM orden WHERE id = $1 AND sucursal_id = $2 AND tipo = 'MOSTRADOR'`,
      { bind: [ordenId, sucursalId], type: QueryTypes.SELECT },
    );
    const numeroLlamado = filas[0]?.numero_llamado;
    if (numeroLlamado === undefined || numeroLlamado === null) return undefined;
    return {
      ordenId,
      numeroLlamado,
      envio: await this.vista.armarEnvio(ordenId, sucursalId),
    };
  }
}
