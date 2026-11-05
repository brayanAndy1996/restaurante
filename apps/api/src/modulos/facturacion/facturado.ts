import { Inject, Injectable } from '@nestjs/common';
import type { ParteCalculada } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';

/**
 * Lo ya cobrado de una orden (historia 006, criterio 69 y plan "Partes y cambios después de cobrar"): las partes
 * anteriores tal como las devolvió `calcularParte` (`comprobante.detalle_parte`), en orden de `numero_parte`, leyendo
 * solo `comprobante`. Con la orden bloqueada no hay otra parte en vuelo. Sirve para que el cobro calcule "lo que
 * falta" y para que el puerto `COBROS` aplique `cambioDeCuentaPermitido`. No hay otra fuente de verdad para lo
 * cobrado; en 6b, si una nota de crédito anula partes, este es el único lugar que cambia.
 */
@Injectable()
export class FacturadoService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  async facturadoDeOrden(ordenId: string): Promise<ParteCalculada[]> {
    const filas = await this.conexion.query<{ detalle_parte: ParteCalculada }>(
      `SELECT detalle_parte FROM comprobante
        WHERE orden_id = $1 AND detalle_parte IS NOT NULL
        ORDER BY numero_parte`,
      { bind: [ordenId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => f.detalle_parte);
  }
}
