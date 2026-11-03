import { Injectable } from '@nestjs/common';
import type {
  EstadoLlamadoPublico,
  LlamadoDetalle,
  LlamadosRespuesta,
  MesaPublica,
} from '@restaurante/contratos';

/**
 * Lecturas de los llamados (historia 005, criterios 25, 38, 39 y 40): la mesa pública, el estado para el cliente,
 * la lista del mozo y el detalle con la revisión. El vencimiento se calcula al leer con el reloj de la API
 * (criterio 54). FIRMAS: la implementación llega en la fase C (T10 y T12).
 */
@Injectable()
export class VistaLlamadosService {
  /** `GET /publico/mesas/:codigo` (criterio 25). */
  async mesaPublica(codigo: string): Promise<MesaPublica> {
    void codigo;
    throw new Error('No implementado');
  }

  /** `GET /publico/mesas/:codigo/llamados/:id` (criterio 38). */
  async estadoPublico(codigo: string, llamadoId: string): Promise<EstadoLlamadoPublico> {
    void codigo;
    void llamadoId;
    throw new Error('No implementado');
  }

  /** `GET /llamados` (criterio 39), de la sucursal activa. */
  async lista(): Promise<LlamadosRespuesta> {
    throw new Error('No implementado');
  }

  /** `GET /llamados/:id` (criterio 40), con la revisión de cada línea. */
  async detalle(llamadoId: string): Promise<LlamadoDetalle> {
    void llamadoId;
    throw new Error('No implementado');
  }
}
