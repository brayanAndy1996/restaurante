import { Injectable } from '@nestjs/common';
import type {
  AtencionEntrada,
  AtencionRespuesta,
  DescarteEntrada,
  LlamadoDetalle,
} from '@restaurante/contratos';

/**
 * Atender y descartar un llamado (historia 005, criterios 41 a 45, 53 y 54; ruta crítica P2). Toda escritura
 * empieza bloqueando la fila del llamado. FIRMAS: la implementación llega en la fase C (T12).
 */
@Injectable()
export class AtencionLlamadosService {
  /** `POST /llamados/:id/atencion` (criterios 41 a 45): abre la mesa libre con `AperturaDeMesasService`. */
  async atender(llamadoId: string, entrada: AtencionEntrada): Promise<AtencionRespuesta> {
    void llamadoId;
    void entrada;
    throw new Error('No implementado');
  }

  /** `POST /llamados/:id/descarte` (criterio 53). */
  async descartar(llamadoId: string, entrada: DescarteEntrada): Promise<LlamadoDetalle> {
    void llamadoId;
    void entrada;
    throw new Error('No implementado');
  }
}
