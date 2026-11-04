import { Injectable } from '@nestjs/common';
import type { SerieEntrada, SerieRespuesta } from '@restaurante/contratos';
import type { TipoComprobante } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';

/**
 * Series de comprobantes por caja (historia 006, criterios 3 a 5; ruta crítica P4): dueño de la tabla `serie`.
 * Una serie pertenece al emisor de la sucursal de la caja al crearla, es única por emisor y tipo (en ninguna caja ni
 * sucursal se repite, activa o inactiva) y no se edita ni se borra. FIRMAS de la fase A.
 */

export interface ConfigurarSerie {
  sucursalId: string;
  cajaId: string;
  tipo: TipoComprobante;
  entrada: SerieEntrada;
}

@Injectable()
export class SeriesService {
  /**
   * Deja la serie dada como la activa de ese tipo en la caja (la anterior queda inactiva con sus números), o
   * reactiva una inactiva de la caja. 409 `CONFLICTO` con `campos.serie` si otra caja del emisor ya la usa. Deja
   * `configurar_serie` en la auditoría (sin fila si no cambia nada). Devuelve las series de la caja.
   */
  async configurar(_datos: ConfigurarSerie): Promise<SerieRespuesta[]> {
    throw noImplementado();
  }

  /** Las series de cada caja pedida (activas e inactivas), para armar la `cajaRespuesta`. */
  async seriesDeCajas(_cajaIds: readonly string[]): Promise<Map<string, SerieRespuesta[]>> {
    throw noImplementado();
  }
}
