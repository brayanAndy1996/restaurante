import { Injectable } from '@nestjs/common';
import type { ReporteCaja } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Arma el `reporteCaja` de un turno para el X y el Z (historia 006, criterios 29 y 31): sumas agrupadas por medio y
 * por tipo en SQL con un número fijo de consultas, montos en `NUMERIC`; el esperado y las diferencias salen de
 * `esperadoDelTurno` y `diferenciasDelArqueo` de `packages/dominio`. FIRMA de la fase A.
 */
@Injectable()
export class ReportesCaja {
  async armar(_turnoId: string): Promise<ReporteCaja> {
    throw noImplementado();
  }
}
