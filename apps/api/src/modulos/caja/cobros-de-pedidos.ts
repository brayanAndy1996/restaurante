import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import type { CuentaEntrada, ResultadoCambioDeCuenta } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores';
import { RegistroDeCobros, type CobrosPuerto } from '../pedidos';
import { FacturadoService } from '../facturacion';

/**
 * Implementa el puerto `COBROS` de pedidos (historia 006, criterios 86 a 88; plan "Partes y cambios después de
 * cobrar"): lee las partes cobradas con `FacturadoService.facturadoDeOrden` y aplica `cambioDeCuentaPermitido`. Se
 * registra en pedidos al arrancar, como pedidos lo hace en `UsoDeMesas` de salón. FIRMAS de la fase A.
 */
@Injectable()
export class CobrosDePedidos implements CobrosPuerto, OnModuleInit {
  constructor(
    @Inject(RegistroDeCobros) private readonly registro: RegistroDeCobros,
    @Inject(FacturadoService) private readonly facturado: FacturadoService,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(this);
  }

  async validarCambio(
    _ordenId: string,
    _cuentaNueva: CuentaEntrada,
  ): Promise<ResultadoCambioDeCuenta> {
    void this.facturado;
    throw noImplementado();
  }
}
