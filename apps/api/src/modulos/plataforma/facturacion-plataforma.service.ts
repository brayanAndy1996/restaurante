import { Injectable } from '@nestjs/common';
import type { AlertasPlataformaRespuesta, PadronEstadoRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * Lo que el superadministrador ve y pide de la facturación electrónica (historia 006, entrega 6b, criterios 133 y 138): los
 * conteos de alertas por empresa, el estado del padrón de RUC y la carga a pedido. Plataforma no lee `comprobante`: los
 * conteos y la carga los darán facturación y el worker por puertos que registran al arrancar (T32 y T36).
 *
 * Fase A (T29): solo las firmas; lanzan `Error('No implementado')`.
 */
@Injectable()
export class FacturacionPlataformaService {
  alertas(): Promise<AlertasPlataformaRespuesta> {
    return Promise.reject(noImplementado());
  }

  estadoDelPadron(): Promise<PadronEstadoRespuesta> {
    return Promise.reject(noImplementado());
  }

  /** Encola la carga del padrón (una a la vez); deja `cargar_padron` en `auditoria` (origen `plataforma`). */
  pedirCargaDelPadron(): Promise<void> {
    return Promise.reject(noImplementado());
  }
}
