import { Injectable } from '@nestjs/common';
import type {
  CobroEntradaValidada,
  CobroRespuesta,
  CuentaRespuesta,
  CuentaResumen,
} from '@restaurante/contratos';
import { noImplementado } from '../../nucleo/errores';

/**
 * Cobro y consulta de la cuenta (historia 006, criterios 36, 37 y 47 a 68; ruta crítica P2): dueño de `cobro` y
 * `pago`. El cobro corre en una sola transacción con este orden fijo de bloqueos: orden, turno, serie, cuota; el
 * servidor recalcula todo con `packages/dominio` y emite el comprobante con `EmisionService`. FIRMAS de la fase A.
 */
@Injectable()
export class CobrosService {
  /** `GET /cuentas/:ordenId`: la cuenta con sus montos de `calcularCuenta`. */
  async cuenta(_ordenId: string): Promise<CuentaRespuesta> {
    throw noImplementado();
  }

  /** `GET /cuentas`: las órdenes abiertas de la sucursal activa. */
  async cuentasPorCobrar(): Promise<CuentaResumen[]> {
    throw noImplementado();
  }

  async cobrar(_ordenId: string, _entrada: CobroEntradaValidada): Promise<CobroRespuesta> {
    throw noImplementado();
  }
}
