import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  VentaMostradorEntradaValidada,
  VentaMostradorRespuesta,
} from '@restaurante/contratos';
import { jsonCanonico } from '../../nucleo/idempotencia';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CuentasDePedidos } from '../pedidos';
import { SesionActual } from '../seguridad';
import { CobrosService, exigirMontosEnRango, normalizar } from './cobros.service';
import { ventaCambio } from './errores-caja';
import { ParametrosDeCuenta } from './parametros-de-cuenta';

const sha256 = (texto: string): Buffer => createHash('sha256').update(texto, 'utf8').digest();

/**
 * La huella de la venta para reconocer la réplica por `id` (criterio 83): el turno, las líneas (con ids en minúsculas
 * y modificadores ordenados, en el orden en que se pidieron), el comprobante, los pagos y el redondeo. Sin `total`:
 * es lo que vio la persona y cambia entre reintentos sin que la venta sea otra.
 */
function huellaDeVenta(
  id: string,
  entrada: VentaMostradorEntradaValidada,
  normal: ReturnType<typeof normalizar>,
): Buffer {
  return sha256(
    jsonCanonico({
      ventaMostrador: id,
      turnoId: normal.turnoId,
      lineas: entrada.lineas.map((l) => ({
        productoId: l.productoId.toLowerCase(),
        modificadorIds: l.modificadorIds.map((m) => m.toLowerCase()).sort(),
        cantidad: l.cantidad,
        observacion: l.observacion ?? null,
        tiempo: l.tiempo,
        paraLlevar: l.paraLlevar,
      })),
      comprobante: normal.comprobante,
      pagos: normal.pagos,
      redondeo: normal.redondeo,
    }),
  );
}

/**
 * Venta de mostrador (historia 006, criterios 79 a 85; ruta crítica P2): se cobra primero y el pedido sale a cocina
 * con un número de llamado, todo o nada en una transacción. Orden fijo: réplica por `id` (es el id de la orden, del
 * envío y del cobro); turno `FOR SHARE`; parámetros del emisor; pedidos abre la orden `MOSTRADOR`, toma el número de
 * llamado y corre el envío de 004; el total con la carta vigente; y los pasos del cobro (`CobrosService.liquidar`)
 * como una parte `TOTAL`. Si cualquier paso lanza, la transacción entera se revierte: la orden, las comandas, el
 * inventario, el número de llamado, el número de serie y la cuota. Los eventos y los trabajos de impresión salen
 * después de confirmar.
 */
@Injectable()
export class MostradorService {
  constructor(
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(CuentasDePedidos) private readonly cuentas: CuentasDePedidos,
    @Inject(ParametrosDeCuenta) private readonly parametros: ParametrosDeCuenta,
    @Inject(CobrosService) private readonly cobros: CobrosService,
  ) {}

  async vender(entrada: VentaMostradorEntradaValidada): Promise<VentaMostradorRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const id = entrada.id.toLowerCase();
    // Un cobro `TOTAL` de la orden nueva: `version` no cuenta (la orden aún no existe).
    const normal = normalizar(id, { ...entrada, version: 1, parte: { tipo: 'TOTAL' } });
    exigirMontosEnRango(normal);
    const huella = huellaDeVenta(id, entrada, normal);

    // Réplica por id (criterio 83): las simultáneas se turnan y la segunda ve lo ya confirmado.
    await this.cobros.turnarPor(`cobro-id:${id}`);
    const previo = await this.cobros.replica(id, sucursalId, id, huella);
    if (previo !== undefined) {
      const abierto = await this.cuentas.mostradorDe(id);
      if (abierto !== undefined) {
        return {
          venta: { id, ordenId: id, numeroLlamado: abierto.numeroLlamado },
          cobro: previo,
          envio: abierto.envio,
        };
      }
    }

    const turno = await this.cobros.turnoParaCobrar(normal.turnoId, sucursalId);
    const instante = this.reloj.ahora();
    const { parametros, emisor } = await this.parametros.paraEmitir(sucursalId, instante);
    this.cobros.exigirComprobantePermitido(normal, parametros);

    // Pedidos crea la orden, toma el número de llamado y envía a cocina (004): valida cada línea y descuenta el stock.
    const abierto = await this.cuentas.abrirYEnviarMostrador({ id, lineas: entrada.lineas });
    const cuenta = await this.cuentas.cuentaParaCobrar(id, { bloquear: true });

    const cobro = await this.cobros.liquidar({
      id,
      ordenId: id,
      sucursalId,
      cuenta,
      turno,
      normal,
      huella,
      parametros,
      emisor,
      instante,
      alCambiarElTotal: (totalNuevo) => ventaCambio(totalNuevo),
    });
    return {
      venta: { id, ordenId: id, numeroLlamado: abierto.numeroLlamado },
      cobro,
      envio: abierto.envio,
    };
  }
}
