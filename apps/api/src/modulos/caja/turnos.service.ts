import { Injectable } from '@nestjs/common';
import type {
  AbrirTurnoEntrada,
  CierreEntradaValidada,
  ImpresionDeCajaRespuesta,
  MovimientoEntrada,
  MovimientoRespuesta,
  ReporteCaja,
  TurnoRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Turnos de caja (historia 006, criterios 24 a 35; ruta crítica P3): dueño de `turno`, `turno_conteo` y
 * `movimiento_caja`. Apertura con fondo (tras la comprobación de la suscripción de la sucursal, criterio 25), uno por caja y uno por
 * persona, ingresos y egresos, reporte X, cierre con Z (arqueo a ciegas, motivo de cada diferencia y bloqueo del
 * último turno con mesas abiertas). FIRMAS de la fase A.
 */
@Injectable()
export class TurnosService {
  async abrir(_entrada: AbrirTurnoEntrada): Promise<TurnoRespuesta> {
    throw noImplementado();
  }

  /** El turno `ABIERTO` de la persona en la sucursal activa; 404 si no tiene. */
  async mio(): Promise<TurnoRespuesta> {
    throw noImplementado();
  }

  async consultar(_turnoId: string): Promise<TurnoRespuesta> {
    throw noImplementado();
  }

  async registrarMovimiento(
    _turnoId: string,
    _entrada: MovimientoEntrada,
  ): Promise<MovimientoRespuesta> {
    throw noImplementado();
  }

  /** El reporte X de un turno abierto, o el Z de uno cerrado. */
  async reporte(_turnoId: string): Promise<ReporteCaja> {
    throw noImplementado();
  }

  /** Encola un trabajo `REPORTE_X` en la impresora de la caja. */
  async imprimirReporteX(_turnoId: string): Promise<ImpresionDeCajaRespuesta> {
    throw noImplementado();
  }

  async cerrar(_turnoId: string, _entrada: CierreEntradaValidada): Promise<ReporteCaja> {
    throw noImplementado();
  }
}
