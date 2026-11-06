import { Injectable } from '@nestjs/common';
import type { NotaCreditoEntradaValidada, NotaCreditoRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Notas de crédito (historia 006, entrega 6b, criterios 143 a 157; ruta crítica P8). Caja es dueña de `nota_credito` y
 * orquesta la operación como el cobro: réplica por `id`, `EmisionService.prepararNotaCredito`, el turno de la devolución
 * (`FOR SHARE`), `validarPagos`, `EmisionService.numerarNotaCredito`, los egresos en `movimiento_caja` (uno por pago, con
 * `medio` y `operacion`), la respuesta guardada, la auditoría `emitir_nota_credito` y `turno.cambio`.
 *
 * Fase A (T29): solo la firma; lanza `Error('No implementado')` hasta T40.
 */
@Injectable()
export class NotasCreditoService {
  emitir(entrada: NotaCreditoEntradaValidada): Promise<NotaCreditoRespuesta> {
    void entrada;
    return Promise.reject(noImplementado());
  }
}
