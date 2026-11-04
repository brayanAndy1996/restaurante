import { Injectable } from '@nestjs/common';
import type { DocumentoTicket, ReporteCaja } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Documentos de impresión de caja (historia 006, criterios 93 y 95): el reporte X, la Z y el pulso solo de la gaveta
 * (apertura con fondo y movimientos), que se encolan con `ImpresionPuerto.encolar`. El ticket del comprobante lo
 * arma la facturación. FIRMAS de la fase A.
 */
@Injectable()
export class TicketsDeCaja {
  reporte(_tipo: 'REPORTE_X' | 'REPORTE_Z', _reporte: ReporteCaja): DocumentoTicket {
    throw noImplementado();
  }

  /** Un documento `GAVETA` con solo el bloque `gaveta` (sin avance ni corte). */
  gaveta(): DocumentoTicket {
    throw noImplementado();
  }
}
