import { Inject, Injectable } from '@nestjs/common';
import type {
  ComprobanteRespuesta,
  ComprobanteResumen,
  ComprobantesConsulta,
  ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import type { TipoComprobante } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';
import { RegistroImpresoraDeCaja } from './impresora-de-caja';

/**
 * Lo que los comprobantes de un turno aportan al reporte X y a la Z (historia 006, criterio 29): caja no lee
 * `comprobante`, así que facturación lo suma con `comprobante.turno_id`.
 */
export interface ResumenTributarioDeTurno {
  /** Comprobantes del turno y la suma de sus totales. */
  cantidad: number;
  total: string;
  porTipo: { tipo: TipoComprobante; cantidad: number; total: string }[];
  descuentos: string;
  /** Valor referencial de las operaciones gratuitas (cortesías). */
  cortesias: string;
  igv: string;
  icbper: string;
}

/**
 * Consulta e impresión de comprobantes (historia 006, criterios 77 y 90). Un Cajero solo ve los de sus propios
 * turnos (criterio 100), que filtra con `turno_responsable_id` sin leer `turno`. FIRMAS de la fase A.
 */
@Injectable()
export class ComprobantesService {
  constructor(
    @Inject(RegistroImpresoraDeCaja) private readonly impresoras: RegistroImpresoraDeCaja,
  ) {}

  async consultar(_id: string): Promise<ComprobanteRespuesta> {
    throw noImplementado();
  }

  /** Hasta 200, del más nuevo al más antiguo. */
  async listar(_consulta: ComprobantesConsulta): Promise<ComprobanteResumen[]> {
    throw noImplementado();
  }

  /**
   * Reimprime el ticket con la marca "REIMPRESIÓN" en la impresora de la caja del comprobante, que le da el módulo
   * de caja por `RegistroImpresoraDeCaja`. 409 `SIN_IMPRESORA` si no hay impresora de caja.
   */
  async imprimir(_id: string): Promise<ImpresionDeCajaRespuesta> {
    void this.impresoras;
    throw noImplementado();
  }

  /** El resumen tributario de un turno para el X y la Z (una consulta). */
  async resumenDeTurno(_turnoId: string): Promise<ResumenTributarioDeTurno> {
    throw noImplementado();
  }
}
