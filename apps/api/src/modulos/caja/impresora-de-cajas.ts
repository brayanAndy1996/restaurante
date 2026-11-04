import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RegistroImpresoraDeCaja, type ImpresoraDeCaja } from '../facturacion';
import { IMPRESION, type ImpresionPuerto } from '../pedidos/impresion';

/**
 * La impresora de una caja para quien la pide por id de caja (historia 006, criterios 2 y 90): lee
 * `caja.impresora_id` de su propia tabla y llama a `ImpresionPuerto.impresoraDeLaCaja(sucursalId, impresoraId)`, que
 * cae en la impresora de caja de la sucursal si la propia no está activa. Se registra en facturación al arrancar
 * para que la reimpresión de un comprobante encuentre la impresora sin que facturación lea `caja`.
 */
@Injectable()
export class ImpresoraDeCajas implements OnModuleInit {
  constructor(
    @Inject(RegistroImpresoraDeCaja) private readonly registro: RegistroImpresoraDeCaja,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
  ) {}

  onModuleInit(): void {
    this.registro.registrar((cajaId) => this.deLaCaja(cajaId));
  }

  /** La impresora para el ticket de esa caja, o `null` si ni la caja ni la sucursal tienen una activa (criterio 96). */
  async deLaCaja(cajaId: string): Promise<ImpresoraDeCaja | null> {
    const cajas = await this.conexion.query<{ sucursal_id: string; impresora_id: string | null }>(
      'SELECT sucursal_id, impresora_id FROM caja WHERE id = $1',
      { bind: [cajaId], type: QueryTypes.SELECT },
    );
    const caja = cajas[0];
    if (caja === undefined) return null;
    return this.impresion.impresoraDeLaCaja(caja.sucursal_id, caja.impresora_id);
  }
}
