import { Inject, Injectable } from '@nestjs/common';
import type {
  CobroEntradaValidada,
  CobroRespuesta,
  CuentaRespuesta,
  CuentaResumen,
} from '@restaurante/contratos';
import { fechaLima } from '@restaurante/dominio';
import {
  calcularCuenta,
  montoIcbperVigente,
  tasaIgvVigente,
  tiposDeComprobantePermitidos,
  type CuentaEntrada,
} from '@restaurante/dominio/caja';
import { noImplementado } from '../../nucleo/errores';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CuentasDePedidos, type CuentaParaCobrar } from '../pedidos';
import { EmisoresService } from '../plataforma';

/** Los parámetros tributarios de la sucursal con los que se calcula una cuenta (criterio 36). */
type Parametros = CuentaRespuesta['parametros'];

/** `a − b` de montos con 2 decimales, sin bajar de cero (el saldo de una cuenta). */
function restarMontos(a: string, b: string): string {
  const centimos = (m: string): bigint => BigInt(m.replace('.', ''));
  const resta = centimos(a) - centimos(b);
  const c = resta < 0n ? 0n : resta;
  return `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`;
}

/**
 * Cobro y consulta de la cuenta (historia 006, criterios 36, 37 y 47 a 68; ruta crítica P2): dueño de `cobro` y
 * `pago`. La consulta de la cuenta lee las órdenes por `CuentasDePedidos` (pedidos es dueño de ítems, descuentos y
 * cortesías) y calcula los montos con `calcularCuenta` de `packages/dominio`. El cobro corre en una sola transacción
 * con este orden fijo de bloqueos: orden, turno, serie, cuota; el servidor recalcula todo con `packages/dominio` y
 * emite el comprobante con `EmisionService`.
 */
@Injectable()
export class CobrosService {
  constructor(
    @Inject(CuentasDePedidos) private readonly cuentas: CuentasDePedidos,
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** `GET /cuentas/:ordenId`: la cuenta con sus montos de `calcularCuenta` (criterio 36). */
  async cuenta(ordenId: string): Promise<CuentaRespuesta> {
    const cuenta = await this.cuentas.cuentaParaCobrar(ordenId, {
      bloquear: false,
      soloAbiertas: false,
    });
    const parametros = await this.parametros(cuenta.sucursalId);
    const calculada = calcularCuenta(entradaDeCalculo(cuenta, parametros));
    return {
      ordenId: cuenta.ordenId,
      tipo: cuenta.tipo,
      estado: cuenta.estado,
      mesas: cuenta.mesas,
      mozo: cuenta.mozo,
      numeroLlamado: cuenta.numeroLlamado,
      version: cuenta.version,
      lineas: cuenta.lineas.map((l, i) => {
        const c = calculada.lineas[i]!;
        return {
          itemId: l.itemId,
          nombre: l.nombre,
          modificadores: l.modificadores,
          precioUnitario: l.precioUnitario,
          cantidad: l.cantidad,
          cantidadCortesia: l.cantidadCortesia,
          cantidadFacturada: l.cantidadFacturada,
          afectacion: l.afectacion,
          aplicaIcbper: l.aplicaIcbper,
          bruto: c.bruto,
          descuento: l.descuento,
          descuentoCuenta: c.descuentoCuenta,
          neto: c.neto,
          icbper: c.icbper,
        };
      }),
      descuentoCuenta: cuenta.descuentoCuenta,
      cortesias: cuenta.cortesias,
      totales: calculada.totales,
      cobrado: cuenta.cobrado,
      saldo: restarMontos(calculada.totales.total, cuenta.cobrado),
      modo: cuenta.modo,
      // Los cobros llegan con la tabla `cobro` (migración 4, T15).
      cobros: [],
      parametros,
    };
  }

  /** `GET /cuentas`: las órdenes abiertas de la sucursal activa, de la más antigua a la más nueva (criterio 37). */
  async cuentasPorCobrar(): Promise<CuentaResumen[]> {
    const abiertas = await this.cuentas.cuentasAbiertas();
    if (abiertas.length === 0) return [];
    // Una sola sucursal: los parámetros son los mismos para todas.
    const parametros = await this.parametros(abiertas[0]!.sucursalId);
    return abiertas.map((cuenta) => {
      const total = calcularCuenta(entradaDeCalculo(cuenta, parametros)).totales.total;
      return {
        ordenId: cuenta.ordenId,
        tipo: cuenta.tipo,
        mesas: cuenta.mesas,
        mozo: cuenta.mozo,
        abiertaEn: cuenta.abiertaEn.toISOString(),
        estado: cuenta.estado,
        total,
        saldo: restarMontos(total, cuenta.cobrado),
        modo: cuenta.modo,
      };
    });
  }

  async cobrar(_ordenId: string, _entrada: CobroEntradaValidada): Promise<CobroRespuesta> {
    throw noImplementado();
  }

  /**
   * La tasa de IGV vigente hoy en Lima (`null` con un emisor Nuevo RUS o si no hay ninguna configurada: el cobro la
   * rechaza con 409 `TASA_IGV_NO_CONFIGURADA`), el ICBPER vigente, el régimen y los comprobantes permitidos.
   */
  private async parametros(sucursalId: string): Promise<Parametros> {
    const { emisor } = await this.emisores.datosParaComprobante(sucursalId);
    const hoy = fechaLima(this.reloj.ahora());
    const tasa =
      emisor.regimen === 'NUEVO_RUS'
        ? null
        : tasaIgvVigente(await this.emisores.tasasIgv(emisor.id), hoy);
    return {
      tasaIgv: tasa,
      montoIcbper: montoIcbperVigente(hoy),
      regimen: emisor.regimen,
      tiposPermitidos: [...tiposDeComprobantePermitidos(emisor.regimen)],
    };
  }
}

/** La entrada de `calcularCuenta` de una cuenta de pedidos con los parámetros de la sucursal. */
function entradaDeCalculo(cuenta: CuentaParaCobrar, parametros: Parametros): CuentaEntrada {
  return {
    lineas: cuenta.lineas.map((l) => ({
      itemId: l.itemId,
      precioUnitario: l.precioUnitario,
      cantidad: l.cantidad,
      cantidadCortesia: l.cantidadCortesia,
      afectacion: l.afectacion,
      aplicaIcbper: l.aplicaIcbper,
      descuento: l.descuento === null ? null : { tipo: l.descuento.tipo, valor: l.descuento.valor },
    })),
    descuentoCuenta:
      cuenta.descuentoCuenta === null
        ? null
        : { tipo: cuenta.descuentoCuenta.tipo, valor: cuenta.descuentoCuenta.valor },
    // Sin tasa vigente (Nuevo RUS o un emisor que no configuró ninguna) la cuenta no desglosa IGV: `operaciones`
    // `null` e `igv` `"0.00"`. La tasa no tiene valor por defecto; el cobro responde 409 `TASA_IGV_NO_CONFIGURADA`.
    tasaIgv: parametros.tasaIgv,
    montoIcbper: parametros.montoIcbper,
  };
}
