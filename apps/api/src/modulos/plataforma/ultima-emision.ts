import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';

/**
 * Cómo saber la fecha de Lima del último comprobante emitido por un emisor, o `null` si no emitió ninguno
 * (historia 006, criterio 6). Plataforma es dueña de las tasas de IGV pero no lee `comprobante`: lo registra quien sea
 * dueño de los comprobantes (facturación) al arrancar.
 */
export type ConsultaUltimaEmision = (emisorId: string) => Promise<string | null>;

/**
 * Punto de enganche entre las tasas de IGV y los comprobantes (criterio 6), como `UsoDeMesas` de salón: no se puede
 * crear ni cambiar una tasa con `desde` igual o anterior a esa fecha. **Falla cerrado** (fase C): si nadie registró la
 * consulta, `configurarTasaIgv` responde 409 `CONFLICTO` en vez de aceptar la tasa. FIRMAS de la fase A.
 */
@Injectable()
export class UltimaEmisionDeEmisor {
  private consulta: ConsultaUltimaEmision | null = null;

  /** Registra la consulta; la llama `FacturacionModule` al arrancar. */
  registrar(consulta: ConsultaUltimaEmision): void {
    this.consulta = consulta;
  }

  /** La fecha `AAAA-MM-DD` del último comprobante del emisor, o `null` si no emitió ninguno. */
  async fecha(_emisorId: string): Promise<string | null> {
    void this.consulta;
    throw noImplementado();
  }
}
