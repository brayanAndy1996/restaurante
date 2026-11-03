import { Injectable } from '@nestjs/common';
import type { LogoCartaWebRespuesta } from '@restaurante/contratos';

/**
 * Logo de la carta web (historia 005, criterio 3): las reglas de la foto de un producto de 003 (JPEG, PNG o WebP
 * reales, hasta 1 MB, de 64 a 2048 píxeles por lado, dos transacciones cortas alrededor de la subida).
 * FIRMAS: la implementación llega en la fase C (T5).
 */
@Injectable()
export class LogoCartaWebService {
  /** `PUT /carta-web/logo`: auditoría `cambiar_logo_carta_web`. */
  async subir(datos: Buffer, tipo: string): Promise<LogoCartaWebRespuesta> {
    void datos;
    void tipo;
    throw new Error('No implementado');
  }

  /** `DELETE /carta-web/logo`: auditoría `quitar_logo_carta_web`. */
  async quitar(): Promise<void> {
    throw new Error('No implementado');
  }
}
