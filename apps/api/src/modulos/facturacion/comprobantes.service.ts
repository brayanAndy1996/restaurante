import { Injectable } from '@nestjs/common';
import type {
  ComprobanteRespuesta,
  ComprobanteResumen,
  ComprobantesConsulta,
  ImpresionDeCajaRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Consulta e impresión de comprobantes (historia 006, criterios 77 y 90). Un Cajero solo ve los de sus propios
 * turnos (criterio 100). FIRMAS de la fase A.
 */
@Injectable()
export class ComprobantesService {
  async consultar(_id: string): Promise<ComprobanteRespuesta> {
    throw noImplementado();
  }

  /** Hasta 200, del más nuevo al más antiguo. */
  async listar(_consulta: ComprobantesConsulta): Promise<ComprobanteResumen[]> {
    throw noImplementado();
  }

  /** Reimprime el ticket con la marca "REIMPRESIÓN". 409 `SIN_IMPRESORA` si no hay impresora de caja. */
  async imprimir(_id: string): Promise<ImpresionDeCajaRespuesta> {
    throw noImplementado();
  }
}
