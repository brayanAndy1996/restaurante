import { Inject, Injectable } from '@nestjs/common';
import type { OrdenRespuesta } from '@restaurante/contratos';
import { OrdenesService } from './ordenes.service';

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
 * `orden.cambio`) con un `mozoId` explícito, dentro de la transacción de la petición y de la sucursal activa de la
 * sesión. Lo usa el módulo de llamados al atender un llamado de una mesa libre; `PedidosModule` lo exporta y no
 * exporta nada del envío de comandas.
 */
@Injectable()
export class AperturaDeMesasService {
  constructor(@Inject(OrdenesService) private readonly ordenes: OrdenesService) {}

  /**
   * Abre la mesa con las reglas de 004: 404 si la mesa no es de la sucursal activa, 409 `CONFLICTO` si está
   * inactiva, 409 `MESA_OCUPADA` (con el `ordenId` que la ocupa) si ya tiene una orden, 422 `REFERENCIA_INVALIDA` si
   * `mozoId` no atiende mesas en la sucursal y 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` si `id` ya es de otra orden. Un
   * mismo `id` con la misma mesa devuelve la orden existente sin efectos.
   */
  abrir(entrada: AbrirMesaEntrada): Promise<OrdenRespuesta> {
    return this.ordenes.abrir({
      id: entrada.id,
      mesaId: entrada.mesaId,
      comensales: entrada.comensales,
      mozoId: entrada.mozoId,
    });
  }
}
