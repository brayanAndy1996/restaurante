import { Injectable } from '@nestjs/common';
import type { LlamadoEntradaValidada, LlamadoPublico } from '@restaurante/contratos';

/**
 * Crear un llamado desde la mesa (historia 005, criterios 26 a 37; ruta crítica P2): dueño de `llamado` junto con
 * los demás servicios del módulo. Una sola transacción, la del contexto público. FIRMAS: la implementación llega
 * en la fase C (T10).
 */
@Injectable()
export class CreacionLlamadosService {
  /**
   * `POST /publico/mesas/:codigo/llamados` (201 `llamadoPublico`). `ip` es la IP del cliente (de la cabecera de
   * `CABECERA_IP_CLIENTE` o de la conexión): solo se guarda su huella.
   */
  async crear(
    codigo: string,
    entrada: LlamadoEntradaValidada,
    ip: string | undefined,
  ): Promise<LlamadoPublico> {
    void codigo;
    void entrada;
    void ip;
    throw new Error('No implementado');
  }
}
