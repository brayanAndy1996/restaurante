import { Injectable } from '@nestjs/common';
import type { ReemisionEntrada, ReemisionRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * "Emitir otro" (historia 006, entrega 6b, criterio 134): emite un comprobante nuevo, con otro número, en lugar de uno
 * `RECHAZADO` (mismas líneas y totales, `reemplaza_a_id`). 409 `COMPROBANTE_NO_RECHAZADO` / `YA_REEMPLAZADO`.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T32.
 */
@Injectable()
export class ReemisionService {
  reemitir(comprobanteId: string, entrada: ReemisionEntrada): Promise<ReemisionRespuesta> {
    void comprobanteId;
    void entrada;
    return Promise.reject(noImplementado());
  }
}
