import { Injectable } from '@nestjs/common';
import type { OrdenRespuesta } from '@restaurante/contratos';

/** Lo que hace falta para abrir una mesa en nombre de otra persona (historia 005, criterio 42). */
export interface AbrirMesaEntrada {
  /** Id de la orden (UUID que genera la PWA). */
  id: string;
  mesaId: string;
  /** De 1 a 99. */
  comensales: number;
  /** El mozo responsable: quien atiende el llamado. */
  mozoId: string;
}

/**
 * Apertura de mesas para otros módulos (historia 005, plan "Atender"): las reglas de `POST /ordenes` de 004
 * (criterios 9 a 12: bloqueo de la mesa, `MESA_OCUPADA`, índice único de `orden_mesa`, eventos `salon.cambio` y
 * `orden.cambio`) con un `mozoId` explícito, dentro de la transacción de la petición. Lo usa el módulo de llamados
 * al atender un llamado de una mesa libre; `PedidosModule` lo exporta y no exporta nada del envío de comandas.
 * FIRMA: la implementación llega en la fase C (T12).
 */
@Injectable()
export class AperturaDeMesasService {
  async abrir(entrada: AbrirMesaEntrada): Promise<OrdenRespuesta> {
    void entrada;
    throw new Error('No implementado');
  }
}
