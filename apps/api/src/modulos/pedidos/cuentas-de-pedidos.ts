import { Injectable } from '@nestjs/common';
import type {
  CortesiaRespuesta,
  DescuentoRespuesta,
  EnvioRespuesta,
  LineaEnvioEntradaValidada,
} from '@restaurante/contratos';
import type { AfectacionIgv, EstadoOrden, ModoCobro, TipoOrden } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';

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
  /** Suma de lo cobrado en partes anteriores. */
  cobrado: string;
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

@Injectable()
export class CuentasDePedidos {
  /**
   * La cuenta de la orden. Con `bloquear`, la toma con `FOR UPDATE` (el mismo bloqueo que los envíos). 404 si es de
   * otra sucursal, de otra empresa o no existe; 409 `ORDEN_NO_ABIERTA` (con `ordenId` de la principal si está
   * `UNIDA`).
   */
  async cuentaParaCobrar(
    _ordenId: string,
    _opciones: { bloquear: boolean },
  ): Promise<CuentaParaCobrar> {
    throw noImplementado();
  }

  /** Las órdenes abiertas de la sucursal activa con su cuenta, de la más antigua a la más nueva. */
  async cuentasAbiertas(): Promise<CuentaParaCobrar[]> {
    throw noImplementado();
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
