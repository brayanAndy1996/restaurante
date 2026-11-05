import { Inject, Injectable } from '@nestjs/common';
import type {
  CortesiaRespuesta,
  DescuentoRespuesta,
  EnvioRespuesta,
  LineaEnvioEntradaValidada,
} from '@restaurante/contratos';
import type { AfectacionIgv, EstadoOrden, ModoCobro, TipoOrden } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { noImplementado } from '../../nucleo/errores';
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
import { operacionConcurrente, ordenNoEncontrada } from './errores-pedidos';

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

/** Lo que la caja anota en la orden al cobrar una parte (criterio 53). */
export interface CobroParaRegistrar {
  ordenId: string;
  /** Unidades cobradas por ítem en esta parte (suma `item.cantidad_facturada`). */
  itemsFacturados: readonly { itemId: string; cantidad: number }[];
  /** El total de la parte (suma `orden.monto_cobrado`). */
  monto: string;
  modo: ModoCobro | null;
  /** `true` si con esta parte no falta nada: la orden queda `CERRADA` y las mesas, libres. */
  cierra: boolean;
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
      if (descuentoQueNoSeAdmite(cuentaDeDatos(cuenta))) throw operacionConcurrente();
      const respuestas = respuestasDeCuenta(cuenta, nombres);
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
   * Suma lo facturado y lo cobrado, fija el modo, sube la versión y, si `cierra`, deja la orden `CERRADA`, cierra
   * `orden_mesa` y registra `salon.cambio` y `orden.cambio` con `alConfirmar` (criterios 52 y 53).
   */
  async registrarCobro(_cobro: CobroParaRegistrar): Promise<EstadoDeCuentaTrasCobro> {
    throw noImplementado();
  }

  /**
   * Crea la orden `MOSTRADOR` (canal `SALON`, sin mesa ni mozo, 1 comensal), toma su número de llamado y corre el
   * envío de 004 con sus validaciones, su puerto de inventario y sus comandas con el número de llamado
   * (criterios 80 a 82).
   */
  async abrirYEnviarMostrador(_datos: MostradorParaAbrir): Promise<MostradorAbierto> {
    throw noImplementado();
  }
}
