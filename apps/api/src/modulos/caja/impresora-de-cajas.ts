import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';
import { RegistroImpresoraDeCaja, type ImpresoraDeCaja } from '../facturacion';

/**
 * La impresora de una caja para quien la pide por id de caja (historia 006, criterios 2 y 90): lee
 * `caja.impresora_id` de su propia tabla y llama a `ImpresionPuerto.impresoraDeLaCaja(sucursalId, impresoraId)`, que
 * cae en la impresora de caja de la sucursal si la propia no está activa. Se registra en facturación al arrancar
 * para que la reimpresión de un comprobante encuentre la impresora sin que facturación lea `caja`. FIRMAS de la
 * fase A.
 */
@Injectable()
export class ImpresoraDeCajas implements OnModuleInit {
  constructor(
    @Inject(RegistroImpresoraDeCaja) private readonly registro: RegistroImpresoraDeCaja,
  ) {}

  onModuleInit(): void {
    this.registro.registrar((cajaId) => this.deLaCaja(cajaId));
  }

  async deLaCaja(_cajaId: string): Promise<ImpresoraDeCaja | null> {
    throw noImplementado();
  }
}
