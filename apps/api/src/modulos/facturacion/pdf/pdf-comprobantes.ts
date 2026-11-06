import { Injectable } from '@nestjs/common';
import type { ComprobanteRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../../nucleo/errores/no-implementado';

/**
 * La representación impresa en PDF de un comprobante aceptado (historia 006, entrega 6b, criterio 159): A4 vertical, con
 * `pdfkit` y `qrcode` dentro del proceso, sin servicios externos. El worker la arma al aceptarse el comprobante y la
 * guarda en el almacén privado; si falla, el barrido la reintenta.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T43 (que agrega `pdfkit` y `qrcode`).
 */
@Injectable()
export class PdfComprobantes {
  /** El PDF del comprobante. `urlConsulta` es la del conector del emisor (`null` si no tiene). */
  armar(
    comprobante: ComprobanteRespuesta,
    opciones: { urlConsulta: string | null },
  ): Promise<Buffer> {
    void comprobante;
    void opciones;
    return Promise.reject(noImplementado());
  }
}
