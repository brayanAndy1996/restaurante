import { Injectable } from '@nestjs/common';
import type { ParteCalculada } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';

/**
 * Lo ya cobrado de una orden (historia 006, plan "Partes y cambios después de cobrar"): las partes anteriores, en
 * orden de creación, tal como las devolvió `calcularParte`, para que el cobro calcule "lo que falta" y para que el
 * puerto `COBROS` aplique `cambioDeCuentaPermitido`. No hay otra fuente de verdad para lo cobrado. FIRMA de la fase A.
 */
@Injectable()
export class FacturadoService {
  async facturadoDeOrden(_ordenId: string): Promise<ParteCalculada[]> {
    throw noImplementado();
  }
}
