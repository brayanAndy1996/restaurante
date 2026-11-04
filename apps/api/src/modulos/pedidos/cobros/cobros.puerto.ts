import { Injectable } from '@nestjs/common';
import type { CuentaEntrada, ResultadoCambioDeCuenta } from '@restaurante/dominio';
import { noImplementado } from '../../../nucleo/errores';

/**
 * Puerto `COBROS` de pedidos (historia 006, criterios 86 a 88; ruta crítica P2). Pedidos es dueño de las órdenes y no
 * lee las tablas de caja: antes de confirmar un envío, una anulación de ítem o una unión de una orden con
 * `cobros > 0`, arma la cuenta que quedaría y le pregunta a quien implemente este puerto (el módulo de caja, que lo
 * registra al arrancar) si sigue cuadrando con lo ya cobrado (`cambioDeCuentaPermitido` de `packages/dominio`).
 */

/** Token de Nest del puerto de cobros. */
export const COBROS = Symbol('COBROS');

export interface CobrosPuerto {
  /**
   * `{ permitido: true }` o `{ permitido: false, codigo: 'CUENTA_COBRADA_EN_PARTE' }` (409; quien llama revierte la
   * transacción, también la autorización de la anulación). `cuentaNueva` es la cuenta como quedaría.
   */
  validarCambio(ordenId: string, cuentaNueva: CuentaEntrada): Promise<ResultadoCambioDeCuenta>;
}

/**
 * Punto de enganche entre pedidos y caja, como `UsoDeMesas` de salón: `CajaModule` registra su implementación al
 * arrancar con `registrar`. **Falla cerrado** (fase C): si nadie se registró, toda orden con `cobros > 0` rechaza el
 * cambio. FIRMA de la fase A.
 */
@Injectable()
export class RegistroDeCobros implements CobrosPuerto {
  private puerto: CobrosPuerto | null = null;

  /** Registra quien valida los cambios de una cuenta con cobros. */
  registrar(puerto: CobrosPuerto): void {
    this.puerto = puerto;
  }

  async validarCambio(
    _ordenId: string,
    _cuentaNueva: CuentaEntrada,
  ): Promise<ResultadoCambioDeCuenta> {
    void this.puerto;
    throw noImplementado();
  }
}
