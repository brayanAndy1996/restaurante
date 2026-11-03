import { Injectable } from '@nestjs/common';
import type { PasoACuentaEntrada, PasoACuentaRespuesta } from '@restaurante/contratos';

/**
 * Pasar un llamado a la cuenta de la mesa (historia 005, criterios 46 a 52; ruta crítica P3). No toca ninguna tabla
 * de pedidos —la orden solo se lee— ni usa el servicio de envíos: nada llega a cocina. FIRMAS: la implementación
 * llega en la fase C (T12).
 */
@Injectable()
export class PasoACuentaService {
  /** `POST /llamados/:id/paso-a-cuenta`: las líneas salen con los precios del sistema, todo o nada. */
  async pasar(llamadoId: string, entrada: PasoACuentaEntrada): Promise<PasoACuentaRespuesta> {
    void llamadoId;
    void entrada;
    throw new Error('No implementado');
  }
}
