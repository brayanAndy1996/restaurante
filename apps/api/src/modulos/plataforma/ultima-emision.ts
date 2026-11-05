import { Injectable } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * Cómo saber la fecha de Lima del último comprobante emitido por un emisor, o `null` si no emitió ninguno
 * (historia 006, criterio 6). Plataforma es dueña de las tasas de IGV pero no lee `comprobante`: lo registra quien sea
 * dueño de los comprobantes (facturación) al arrancar.
 */
export type ConsultaUltimaEmision = (emisorId: string) => Promise<string | null>;

/**
 * Punto de enganche entre las tasas de IGV y los comprobantes (criterio 6), como `UsoDeMesas` de salón: no se puede
 * crear ni cambiar una tasa con `desde` igual o anterior a esa fecha. **Falla cerrado**: si nadie registró la
 * consulta, `configurarTasaIgv` responde 409 `CONFLICTO` en vez de aceptar la tasa.
 */
@Injectable()
export class UltimaEmisionDeEmisor {
  private consulta: ConsultaUltimaEmision | null = null;

  /** Registra la consulta; la llama `FacturacionModule` al arrancar. */
  registrar(consulta: ConsultaUltimaEmision): void {
    this.consulta = consulta;
  }

  /** La fecha `AAAA-MM-DD` del último comprobante del emisor, o `null` si no emitió ninguno. */
  async fecha(emisorId: string): Promise<string | null> {
    if (this.consulta === null) {
      throw new ErrorAplicacion(
        409,
        'CONFLICTO',
        'No se puede comprobar si el emisor ya emitió comprobantes: no se cambia la tasa',
      );
    }
    return this.consulta(emisorId);
  }
}
