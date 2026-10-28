import { Injectable } from '@nestjs/common';
import type { AgotadoRespuesta } from '@restaurante/contratos';
import type { HastaAgotado, OrigenAgotado } from '@restaurante/dominio';
import { noImplementado } from './errores-carta';

/** Entrada de `CartaDisponibilidadService.marcarAgotado` (criterio 53). */
export interface MarcarAgotadoEntrada {
  sucursalId: string;
  productoId: string;
  hasta: HastaAgotado;
  origen: OrigenAgotado;
}

/** Entrada de `CartaDisponibilidadService.reactivar` (criterio 53). */
export interface ReactivarEntrada {
  sucursalId: string;
  productoId: string;
}

/**
 * Agotados (86) con la sucursal y el origen explícitos: lo usan los controladores y la sección 6 (agotado
 * automático por falta de stock). Firmas de la fase A: sin lógica hasta la tarea T24. Corren dentro de un
 * contexto de empresa con actor (de sistema o de persona).
 */
@Injectable()
export class CartaDisponibilidadService {
  /** Criterios 39, 40 y 46: marca o actualiza el agotado; sin cambios, no audita ni publica. */
  marcarAgotado(entrada: MarcarAgotadoEntrada): Promise<AgotadoRespuesta> {
    void entrada;
    return Promise.reject(noImplementado());
  }

  /** Criterio 41: reactiva; si no estaba agotado (o ya había vencido), no audita ni publica. */
  reactivar(entrada: ReactivarEntrada): Promise<void> {
    void entrada;
    return Promise.reject(noImplementado());
  }
}
