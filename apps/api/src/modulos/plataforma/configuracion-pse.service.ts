import { Injectable } from '@nestjs/common';
import type { ConfiguracionPseEntrada, ConfiguracionPseRespuesta } from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/**
 * La configuración del PSE de cada emisor (historia 006, entrega 6b, criterios 122 y 123): el modo (`SIMULADO` o `REAL`) y
 * la credencial cifrada. Solo la escribe el superadministrador, por una operación de plataforma (`restaurante_plataforma`,
 * que tiene `INSERT` y `UPDATE` sobre `configuracion_pse`); `restaurante_api` solo la lee. Ningún valor de la credencial
 * sale nunca en una respuesta, un evento, la auditoría ni un registro.
 *
 * Fase A (T29): solo las firmas; lanzan `Error('No implementado')` hasta T30.
 */
@Injectable()
export class ConfiguracionPseService {
  /** `GET`: 200 `configuracionPseRespuesta`; 404 si la empresa o el emisor no existen. */
  obtener(empresaId: string, emisorId: string): Promise<ConfiguracionPseRespuesta> {
    void empresaId;
    void emisorId;
    return Promise.reject(noImplementado());
  }

  /**
   * `PUT`: 200 `configuracionPseRespuesta`; 404; 409 `PSE_NO_CONFIGURADO` (pidió `REAL` sin adaptador) o `MODO_PSE_INVALIDO`
   * (de `SIMULADO` a `REAL` con comprobantes emitidos, o de `REAL` a `SIMULADO`). Repetir lo mismo no cambia nada ni audita.
   */
  configurar(
    empresaId: string,
    emisorId: string,
    entrada: ConfiguracionPseEntrada,
  ): Promise<ConfiguracionPseRespuesta> {
    void empresaId;
    void emisorId;
    void entrada;
    return Promise.reject(noImplementado());
  }
}
