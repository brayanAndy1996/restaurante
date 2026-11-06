import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { MEDIOS_PAGO, type MedioPago } from '@restaurante/dominio';
import {
  RegistroDevolucionDeNota,
  RegistroImpresoraDeCaja,
  RegistroPagosDeCobro,
  type DevolucionDeNota,
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
    @Inject(RegistroDevolucionDeNota) private readonly registroDevolucion: RegistroDevolucionDeNota,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(IMPRESION) private readonly impresion: ImpresionPuerto,
  ) {}

  onModuleInit(): void {
    this.registro.registrar((cajaId) => this.deLaCaja(cajaId));
    this.registroPagos.registrar((cobroId) => this.pagosDelCobro(cobroId));
    this.registroDevolucion.registrar((notaId) => this.devolucionDeLaNota(notaId));
  }

  /**
   * Lo que se devolvió con una nota de crédito (criterios 150 y 157), para reimprimir su ticket: los egresos del turno
   * ligados a la nota (`movimiento_caja.comprobante_id`), uno por medio y en el orden de `MEDIOS_PAGO`, y el redondeo del
   * efectivo (el total de la nota menos lo devuelto, por resta en la base). `null` si la nota no tuvo devolución.
   */
  async devolucionDeLaNota(notaId: string): Promise<DevolucionDeNota | null> {
    const filas = await this.conexion.query<{ medio: MedioPago; monto: string; redondeo: string }>(
      `SELECT m.medio, m.monto::text AS monto, (n.total - sum(m.monto) OVER ())::text AS redondeo
         FROM movimiento_caja m
         JOIN nota_credito n ON n.comprobante_id = m.comprobante_id AND n.empresa_id = m.empresa_id
        WHERE m.comprobante_id = $1 AND m.tipo = 'EGRESO'`,
      { bind: [notaId], type: QueryTypes.SELECT },
    );
    const primera = filas[0];
    if (primera === undefined) return null;
    const pagos = filas
      .map((f) => ({ medio: f.medio, monto: f.monto }))
      .sort((a, b) => MEDIOS_PAGO.indexOf(a.medio) - MEDIOS_PAGO.indexOf(b.medio));
    return { pagos, redondeo: primera.redondeo };
  }

  /** Cómo se pagó un cobro (para reimprimir el ticket de un comprobante que se emitió sin impresora), o `null`. */
  async pagosDelCobro(cobroId: string): Promise<PagosDeUnCobro | null> {
    const cobros = await this.conexion.query<{ vuelto: string; redondeo: string }>(
      'SELECT vuelto::text AS vuelto, redondeo::text AS redondeo FROM cobro WHERE id = $1',
      { bind: [cobroId], type: QueryTypes.SELECT },
    );
    const cobro = cobros[0];
    if (cobro === undefined) return null;
    // Los pagos en el orden en que se cobraron: el de `cobro.respuesta`. Los de la tabla `pago` se guardan todos con el
    // mismo `creado_en` (el de la transacción), así que no tienen un orden propio.
    const pagos = await this.conexion.query<PagosDeUnCobro['pagos'][number]>(
      `SELECT t.p ->> 'medio' AS medio, t.p ->> 'monto' AS monto, t.p ->> 'recibido' AS recibido
         FROM cobro c
        CROSS JOIN LATERAL jsonb_array_elements(c.respuesta -> 'pagos') WITH ORDINALITY AS t(p, n)
        WHERE c.id = $1
        ORDER BY t.n`,
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
