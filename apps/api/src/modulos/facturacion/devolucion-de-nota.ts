import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RegistroDevolucionDeNota, type DevolucionDeNota } from './impresora-de-caja';

/** Cuántos eslabones de reemisión se siguen como máximo (una nota rechazada que se emite otra vez, y otra vez…). */
const MAXIMO_DE_REEMISIONES = 10;

/**
 * La devolución que lleva el ticket de una nota de crédito (historia 006, criterio 157): lo devuelto por cada medio y el
 * redondeo del efectivo. Los egresos los da el puerto de caja (`RegistroDevolucionDeNota`, que falla cerrado: facturación no
 * lee `movimiento_caja`). Una nota que reemplazó a una rechazada (criterio 134) no tiene egresos propios: la devolución fue
 * la de la nota rechazada, así que se sigue la cadena `reemplaza_a_id` hasta la primera con egresos. Sin devolución en
 * ninguna, `null`.
 */
@Injectable()
export class DevolucionDeNotaParaTicket {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(RegistroDevolucionDeNota) private readonly registro: RegistroDevolucionDeNota,
  ) {}

  /** La devolución de la nota `notaId` (o de la que ella reemplazó), con el contexto de su empresa. */
  async de(notaId: string): Promise<DevolucionDeNota | null> {
    let id: string | null = notaId;
    for (let i = 0; id !== null && i <= MAXIMO_DE_REEMISIONES; i += 1) {
      const devolucion = await this.registro.deLaNota(id);
      if (devolucion !== null) return devolucion;
      const filas: Array<{ reemplaza_a_id: string | null }> = await this.conexion.query(
        'SELECT reemplaza_a_id FROM comprobante WHERE id = $1',
        { bind: [id], type: QueryTypes.SELECT },
      );
      id = filas[0]?.reemplaza_a_id ?? null;
    }
    return null;
  }
}
