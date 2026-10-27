import { Injectable } from '@nestjs/common';
import type { ResultadoEstadoSuscripcion } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';

/** Estado calculado de la suscripción de una sucursal con el reloj de la API. */
export interface EstadoDeSucursal extends ResultadoEstadoSuscripcion {
  sucursalId: string;
  planId: string;
  /** Último día activo (`AAAA-MM-DD`, fecha de Lima). */
  vencimiento: string;
}

/** Resultado de contar un comprobante emitido (criterio 78); `cuota` es `null` si el plan no la define. */
export interface ConsumoRegistrado {
  /** Mes de Lima (`AAAA-MM`). */
  periodo: string;
  emitidos: number;
  cuota: number | null;
  /** `max(0, emitidos − cuota)`; 0 si no hay cuota. */
  excedente: number;
}

/**
 * Único lector y escritor de `plan`, `suscripcion`, `pago_suscripcion` y `consumo_comprobantes`
 * (RF-03 a RF-06). Sus firmas son el contrato para las historias de caja y facturación; la lógica
 * llega con las tareas T26 y T41 (hasta entonces lanzan `Error('No implementado')`).
 */
@Injectable()
export class SuscripcionService {
  /** Estado de la sucursal con el reloj de la API; debe llamarse dentro de un contexto de empresa. */
  async estadoDeSucursal(_sucursalId: string): Promise<EstadoDeSucursal> {
    return noImplementado();
  }

  /**
   * No lanza si la sucursal está `ACTIVA` o `EN_GRACIA`; lanza 403 `SUCURSAL_SUSPENDIDA` si está
   * `SUSPENDIDA` (criterio 81). La llama solo la apertura de caja.
   */
  async exigirAperturaDeCaja(_sucursalId: string): Promise<void> {
    return noImplementado();
  }

  /**
   * Suma 1 al consumo del mes de Lima de `instante` dentro del contexto de empresa; nunca lanza por
   * superar la cuota (criterio 78). La llama la emisión de cada comprobante, en su misma transacción.
   */
  async registrarComprobanteEmitido(
    _sucursalId: string,
    _instante: Date,
  ): Promise<ConsumoRegistrado> {
    return noImplementado();
  }
}
