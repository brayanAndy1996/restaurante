import { Injectable } from '@nestjs/common';
import type {
  VentaMostradorEntradaValidada,
  VentaMostradorRespuesta,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Venta de mostrador (historia 006, criterios 79 a 85; ruta crítica P2): se cobra primero y el pedido sale a cocina
 * con un número de llamado, todo o nada en una transacción. FIRMA de la fase A.
 */
@Injectable()
export class MostradorService {
  async vender(_entrada: VentaMostradorEntradaValidada): Promise<VentaMostradorRespuesta> {
    throw noImplementado();
  }
}
