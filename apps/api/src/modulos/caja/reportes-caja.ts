import { Inject, Injectable } from '@nestjs/common';
import type { ReporteCaja } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';
import { ComprobantesService } from '../facturacion';

/**
 * Arma el `reporteCaja` de un turno para el X y el Z (historia 006, criterios 29 y 31) con un número fijo de
 * consultas. Caja suma sus propias tablas (cobros, pagos por medio, redondeos, vueltos y movimientos, montos en
 * `NUMERIC`); lo que está en los comprobantes (cantidad y total por tipo, descuentos, cortesías, IGV e ICBPER) lo da
 * `ComprobantesService.resumenDeTurno` de facturación, porque caja no lee `comprobante`. El esperado y las
 * diferencias salen de `esperadoDelTurno` y `diferenciasDelArqueo` de `packages/dominio`. FIRMA de la fase A.
 */
@Injectable()
export class ReportesCaja {
  constructor(@Inject(ComprobantesService) private readonly comprobantes: ComprobantesService) {}

  async armar(_turnoId: string): Promise<ReporteCaja> {
    void this.comprobantes;
    throw noImplementado();
  }
}
