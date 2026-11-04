import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';

/** La impresora de una caja, ya resuelta, y si tiene gaveta. */
export interface ImpresoraDeCaja {
  id: string;
  gaveta: boolean;
}

/** Cómo resolver la impresora de una caja; la registra quien sea dueño de las cajas (el módulo de caja). */
export type ResolutorImpresoraDeCaja = (cajaId: string) => Promise<ImpresoraDeCaja | null>;

/**
 * Punto de enganche entre la reimpresión de un comprobante y las cajas (historia 006, criterio 90). Facturación no
 * lee `caja`: el módulo de caja registra al arrancar (como `COBROS` de pedidos) cómo obtener la impresora de una caja
 * (`caja.impresora_id` más `ImpresionPuerto.impresoraDeLaCaja`). En la emisión no hace falta: el cobro pasa la
 * impresora ya resuelta en `DatosDeEmision`. **Falla cerrado** (fase C): sin registro, reimprimir lanza un error.
 * FIRMAS de la fase A.
 */
@Injectable()
export class RegistroImpresoraDeCaja {
  private resolutor: ResolutorImpresoraDeCaja | null = null;

  registrar(resolutor: ResolutorImpresoraDeCaja): void {
    this.resolutor = resolutor;
  }

  async deLaCaja(_cajaId: string): Promise<ImpresoraDeCaja | null> {
    void this.resolutor;
    throw noImplementado();
  }
}
