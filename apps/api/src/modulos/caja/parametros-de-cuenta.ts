import { Inject, Injectable } from '@nestjs/common';
import type { CuentaRespuesta } from '@restaurante/contratos';
import { fechaLima } from '@restaurante/dominio';
import {
  montoIcbperVigente,
  tasaIgvVigente,
  tiposDeComprobantePermitidos,
} from '@restaurante/dominio/caja';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { EmisoresService } from '../plataforma';

/** Los parámetros tributarios de la sucursal con los que se calcula una cuenta (criterio 36). */
export type Parametros = CuentaRespuesta['parametros'];

/**
 * La tasa de IGV vigente hoy en Lima (`null` con un emisor Nuevo RUS o si no hay ninguna configurada: el cobro la
 * rechaza con 409 `TASA_IGV_NO_CONFIGURADA`; nunca se inventa una), el ICBPER vigente, el régimen y los comprobantes
 * permitidos del emisor de la sucursal. Los usan la consulta de la cuenta, el cobro y el puerto `COBROS`.
 */
@Injectable()
export class ParametrosDeCuenta {
  constructor(
    @Inject(EmisoresService) private readonly emisores: EmisoresService,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /**
   * Los parámetros de la sucursal en la fecha de Lima de `instante` (por defecto, el reloj de la API). Con
   * `paraEmitir` (el cobro y la venta de mostrador) la tasa se lee con el emisor bloqueado en modo compartido hasta el
   * final de la transacción: el cambio de tasa de ese emisor espera a los cobros en curso (criterio 6) y los cobros
   * entre sí no se esperan. Hay que llamarlo después del bloqueo de la orden y del turno y antes del de la serie.
   */
  async de(
    sucursalId: string,
    instante: Date = this.reloj.ahora(),
    paraEmitir = false,
  ): Promise<Parametros> {
    const { emisor } = await this.emisores.datosParaComprobante(sucursalId);
    const hoy = fechaLima(instante);
    const tasa =
      emisor.regimen === 'NUEVO_RUS'
        ? null
        : tasaIgvVigente(
            paraEmitir
              ? await this.emisores.tasasIgvParaEmitir(emisor.id)
              : await this.emisores.tasasIgv(emisor.id),
            hoy,
          );
    return {
      tasaIgv: tasa,
      montoIcbper: montoIcbperVigente(hoy),
      regimen: emisor.regimen,
      tiposPermitidos: [...tiposDeComprobantePermitidos(emisor.regimen)],
    };
  }
}
