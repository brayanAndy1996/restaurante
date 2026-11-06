import type { ComprobanteRespuesta } from '@restaurante/contratos';
import type { DocumentoPse } from './conector-pse';

/**
 * Arma el documento que se manda al PSE solo con lo guardado en el comprobante (historia 006, criterio 120): mismo
 * comprobante, mismo documento, byte a byte. Pura: no lee el reloj ni la base.
 *
 * Fase A (T28/T29): solo la firma; lanza `Error('No implementado')` hasta T30/T31.
 */
export function armarDocumentoPse(comprobante: ComprobanteRespuesta): DocumentoPse {
  void comprobante;
  throw new Error('No implementado');
}
