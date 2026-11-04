import { Injectable } from '@nestjs/common';
import type { ClienteComprobanteEntrada, ComprobanteRespuesta } from '@restaurante/contratos';
import type {
  FormatoComprobante,
  MedioPago,
  ParteCalculada,
  TipoComprobante,
} from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';

/**
 * Emisión de un comprobante (historia 006, criterios 69 a 76 y 90; ruta crítica P4). Se llama dentro de la
 * transacción del cobro: toma el número de la serie de la caja con `UPDATE serie SET ultimo_numero = ultimo_numero + 1
 * … RETURNING` (sin saltos: una reversión deshace el incremento), guarda el comprobante y sus líneas, llama a
 * `SuscripcionService.registrarComprobanteEmitido` una vez y encola el ticket. FIRMAS de la fase A.
 */

export interface PagoParaTicket {
  medio: MedioPago;
  monto: string;
  recibido: string | null;
  operacion: string | null;
}

/**
 * Todo lo que el comprobante guarda al emitirse; el cobro lo arma con lo que recalculó en el servidor. Lleva lo que
 * facturación no puede leer de otros módulos (no lee `caja`, `turno`, `orden` ni `cobro`): la caja, el turno con su
 * responsable, el cobro, el lugar de la parte en la orden, la orden, la impresora ya resuelta, etc.
 */
export interface DatosDeEmision {
  sucursalId: string;
  cajaId: string;
  turnoId: string;
  /** El responsable del turno al emitir (se copia al comprobante: el alcance del Cajero, criterio 100). */
  turnoResponsableId: string;
  cobroId: string;
  /** El lugar de esta parte entre las de la orden: los `cobros` de la cuenta + 1 (1, 2, 3…). */
  numeroParte: number;
  /** La impresora de la caja ya resuelta (`ImpresionPuerto.impresoraDeLaCaja`); `null` si no hay: sin ticket. */
  impresora: { id: string; gaveta: boolean } | null;
  tipo: TipoComprobante;
  formato: FormatoComprobante;
  cliente: ClienteComprobanteEntrada | null;
  /** La parte que se cobra, calculada por `calcularParte` de `packages/dominio`; se guarda en `comprobante.detalle_parte`. */
  parte: ParteCalculada;
  /** La tasa de IGV vigente en la fecha de emisión; `null` con un emisor Nuevo RUS. */
  tasaIgv: string | null;
  /** La descripción de cada ítem para las líneas detalladas (nombre y modificadores). */
  descripciones: ReadonlyMap<string, string>;
  orden: {
    id: string;
    mesas: string[];
    mozo: string | null;
    numeroLlamado: number | null;
  } | null;
  pagos: readonly PagoParaTicket[];
  redondeo: string;
  vuelto: string;
  /** El instante del cobro, del reloj de la API (define la fecha de emisión de Lima y el día operativo). */
  instante: Date;
}

export interface ComprobanteEmitido {
  comprobante: ComprobanteRespuesta;
  /** El trabajo `COMPROBANTE` encolado, o `null` sin impresora. */
  trabajoId: string | null;
  impresion: 'EN_COLA' | 'SIN_IMPRESORA';
}

@Injectable()
export class EmisionService {
  /**
   * 409 `SIN_SERIE` (la caja no tiene serie activa del tipo, o es de otro emisor) o `SERIE_AGOTADA`. Nace
   * `POR_ENVIAR`.
   */
  async emitir(_datos: DatosDeEmision): Promise<ComprobanteEmitido> {
    throw noImplementado();
  }
}
