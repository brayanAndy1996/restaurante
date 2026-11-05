import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import {
  RegistroImpresoraDeCaja,
  RegistroPagosDeCobro,
  type ImpresoraDeCaja,
  type PagosDeUnCobro,
} from '../facturacion';
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
    @Inject(RegistroPagosDeCobro) private readonly registroPagos: RegistroPagosDeCobro,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
  ) {}

  onModuleInit(): void {
    this.registro.registrar((cajaId) => this.deLaCaja(cajaId));
    this.registroPagos.registrar((cobroId) => this.pagosDelCobro(cobroId));
  }

  /** Cómo se pagó un cobro (para reimprimir el ticket de un comprobante que se emitió sin impresora), o `null`. */
  async pagosDelCobro(cobroId: string): Promise<PagosDeUnCobro | null> {
    const cobros = await this.conexion.query<{ vuelto: string; redondeo: string }>(
      'SELECT vuelto::text AS vuelto, redondeo::text AS redondeo FROM cobro WHERE id = $1',
      { bind: [cobroId], type: QueryTypes.SELECT },
    );
    const cobro = cobros[0];
    if (cobro === undefined) return null;
    const pagos = await this.conexion.query<PagosDeUnCobro['pagos'][number]>(
      `SELECT medio, monto::text AS monto, recibido::text AS recibido FROM pago
        WHERE cobro_id = $1 ORDER BY creado_en, id`,
      { bind: [cobroId], type: QueryTypes.SELECT },
    );
    return { pagos, vuelto: cobro.vuelto, redondeo: cobro.redondeo };
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
