import { Injectable } from '@nestjs/common';
import type { Accion } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';

export interface ConsumirAutorizacion {
  autorizacionId: string;
  accion: Accion;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
}

export interface AutorizacionConsumida {
  solicitanteId: string;
  autorizadorId: string;
  motivo: string;
}

/** Autorizaciones de supervisor de un solo uso (HU-03, criterios 44 a 53). */
@Injectable()
export class AutorizacionService {
  /**
   * Consume la autorización de la petición dentro del contexto de la acción (misma transacción): la
   * marca usada solo si es de la sesión, la acción y la sucursal, no se usó y no venció; si no, 403
   * `AUTORIZACION_INVALIDA`. `@Permiso` la llama sola. Lógica en la tarea T38 (hasta entonces lanza
   * `Error('No implementado')`).
   */
  async consumir(_datos: ConsumirAutorizacion): Promise<AutorizacionConsumida> {
    return noImplementado();
  }
}
