import { Injectable } from '@nestjs/common';
import type { CortesiaEntrada, CortesiaRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Cortesías (historia 006, criterios 43 a 46; ruta crítica P5): unidades de un ítem enviado que no se cobran. Como
 * los descuentos, con la clave atada a la cantidad. FIRMAS de la fase A.
 */
@Injectable()
export class CortesiasService {
  async aplicar(_ordenId: string, _entrada: CortesiaEntrada): Promise<CortesiaRespuesta> {
    throw noImplementado();
  }

  async quitar(_ordenId: string, _cortesiaId: string): Promise<void> {
    throw noImplementado();
  }
}
