import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { CuentaEntrada } from '@restaurante/dominio';
import { cambioDeCuentaPermitido, cuentaSinNadaQueFaltar } from '@restaurante/dominio/caja';
import { FacturadoService } from '../facturacion';
import { RegistroDeCobros, type CobrosPuerto, type ResultadoCambioConCobros } from '../pedidos';
import { SesionActual } from '../seguridad';
import { ParametrosDeCuenta } from './parametros-de-cuenta';

/**
 * Implementa el puerto `COBROS` de pedidos (historia 006, criterios 86 y 87; plan "Partes y cambios después de
 * cobrar"): lee las partes cobradas con `FacturadoService.facturadoDeOrden` y aplica `cambioDeCuentaPermitido`. Se
 * registra en pedidos al arrancar, como pedidos lo hace en `UsoDeMesas` de salón. Pedidos arma la cuenta que quedaría
 * sin saber de impuestos; aquí se le ponen el ICBPER y la tasa vigentes de la sucursal, porque el saldo de lo cobrado
 * incluye el ICBPER. Una cuenta que el dominio no puede calcular (`RangeError`) no se admite: falla cerrado.
 */
@Injectable()
export class CobrosDePedidos implements CobrosPuerto, OnModuleInit {
  constructor(
    @Inject(RegistroDeCobros) private readonly registro: RegistroDeCobros,
    @Inject(FacturadoService) private readonly facturado: FacturadoService,
    @Inject(ParametrosDeCuenta) private readonly parametros: ParametrosDeCuenta,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(this);
  }

  async validarCambio(
    ordenId: string,
    cuentaNueva: CuentaEntrada,
  ): Promise<ResultadoCambioConCobros> {
    try {
      const parametros = await this.parametros.de(this.sesion.sucursalActiva());
      const partes = await this.facturado.facturadoDeOrden(ordenId);
      const cuenta = {
        ...cuentaNueva,
        tasaIgv: parametros.tasaIgv,
        montoIcbper: parametros.montoIcbper,
      };
      const resultado = cambioDeCuentaPermitido(cuenta, partes);
      if (!resultado.permitido) return resultado;
      // Si el cambio deja la cuenta sin nada que falte (criterio 52), pedidos cierra la orden en la misma transacción.
      return { permitido: true, cierraLaCuenta: cuentaSinNadaQueFaltar(cuenta, partes) };
    } catch (error) {
      if (error instanceof RangeError) {
        return { permitido: false, codigo: 'CUENTA_COBRADA_EN_PARTE' };
      }
      throw error;
    }
  }
}
