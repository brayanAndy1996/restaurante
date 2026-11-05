import { Injectable } from '@nestjs/common';
import type { CuentaEntrada, ResultadoCambioDeCuenta } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { cuentaCobradaEnParte } from '../errores-pedidos';

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
 * arrancar con `registrar`. **Falla cerrado**: si nadie se registró, toda orden con `cobros > 0` rechaza el cambio
 * (`CUENTA_COBRADA_EN_PARTE`) en lugar de aceptar lo que no puede comprobar.
 */
@Injectable()
export class RegistroDeCobros implements CobrosPuerto {
  private puerto: CobrosPuerto | null = null;

  /** Registra quien valida los cambios de una cuenta con cobros. */
  registrar(puerto: CobrosPuerto): void {
    this.puerto = puerto;
  }

  async validarCambio(
    ordenId: string,
    cuentaNueva: CuentaEntrada,
  ): Promise<ResultadoCambioDeCuenta> {
    if (this.puerto === null) return { permitido: false, codigo: 'CUENTA_COBRADA_EN_PARTE' };
    return this.puerto.validarCambio(ordenId, cuentaNueva);
  }
}

/**
 * Antes de confirmar un envío o una anulación de ítem (criterios 86 y 87): si la orden ya tiene cobros, arma la cuenta
 * que quedaría y le pregunta al puerto si sigue cuadrando con lo cobrado; si no, 409 `CUENTA_COBRADA_EN_PARTE` y quien
 * llama revierte la transacción entera (también la autorización de la anulación). Sin cobros no pregunta nada. La
 * orden ya debe estar bloqueada por quien llama, así `cobros` no cambia mientras tanto.
 */
export async function exigirCambioConCobros(
  conexion: Sequelize,
  puerto: CobrosPuerto,
  ordenId: string,
  cuentaQueQuedaria: () => Promise<CuentaEntrada>,
): Promise<void> {
  const filas = await conexion.query<{ cobros: number }>('SELECT cobros FROM orden WHERE id = $1', {
    bind: [ordenId],
    type: QueryTypes.SELECT,
  });
  if ((filas[0]?.cobros ?? 0) === 0) return;
  const resultado = await puerto.validarCambio(ordenId, await cuentaQueQuedaria());
  if (!resultado.permitido) throw cuentaCobradaEnParte();
}
