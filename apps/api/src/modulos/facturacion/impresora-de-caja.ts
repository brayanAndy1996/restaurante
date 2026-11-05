import { Injectable } from '@nestjs/common';
import type { MedioPago } from '@restaurante/dominio';

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
 * impresora ya resuelta en `DatosDeEmision`. **Falla cerrado**: sin registro, reimprimir lanza un error.
 */
@Injectable()
export class RegistroImpresoraDeCaja {
  private resolutor: ResolutorImpresoraDeCaja | null = null;

  registrar(resolutor: ResolutorImpresoraDeCaja): void {
    this.resolutor = resolutor;
  }

  /** La impresora de la caja, o `null` si no hay ninguna activa. Sin resolutor registrado, lanza (falla cerrado). */
  async deLaCaja(cajaId: string): Promise<ImpresoraDeCaja | null> {
    if (this.resolutor === null) {
      throw new Error('Nadie registró cómo obtener la impresora de una caja (módulo de caja)');
    }
    return this.resolutor(cajaId);
  }
}

/** Cómo se pagó un cobro, para armar de nuevo el ticket de un comprobante que se emitió sin impresora. */
export interface PagosDeUnCobro {
  pagos: { medio: MedioPago; monto: string; recibido: string | null }[];
  vuelto: string;
  redondeo: string;
}

/** Cómo leer los pagos de un cobro; los registra quien sea dueño de los cobros (el módulo de caja). */
export type ResolutorPagosDeCobro = (cobroId: string) => Promise<PagosDeUnCobro | null>;

/**
 * Lo mismo para los pagos de un cobro (historia 006, criterio 90): facturación no lee `cobro` ni `pago`. Solo hace
 * falta cuando un comprobante se emitió sin impresora y después se reimprime (no hay ticket guardado que copiar).
 * **Falla cerrado**: sin registro, lanza un error.
 */
@Injectable()
export class RegistroPagosDeCobro {
  private resolutor: ResolutorPagosDeCobro | null = null;

  registrar(resolutor: ResolutorPagosDeCobro): void {
    this.resolutor = resolutor;
  }

  async deCobro(cobroId: string): Promise<PagosDeUnCobro | null> {
    if (this.resolutor === null) {
      throw new Error('Nadie registró cómo leer los pagos de un cobro (módulo de caja)');
    }
    return this.resolutor(cobroId);
  }
}
