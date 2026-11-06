import { Inject, Injectable } from '@nestjs/common';
import type { ParteCalculada } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';

/**
 * Lo ya cobrado de una orden (historia 006, criterio 69 y plan "Partes y cambios después de cobrar"): las partes
 * anteriores tal como las devolvió `calcularParte` (`comprobante.detalle_parte`), en orden de `numero_parte`, leyendo
 * solo `comprobante`. Con la orden bloqueada no hay otra parte en vuelo. Sirve para que el cobro calcule "lo que
 * falta" y para que el puerto `COBROS` aplique `cambioDeCuentaPermitido`. No hay otra fuente de verdad para lo
 * cobrado. En 6b una nota de crédito no cambia lo cobrado de la orden (criterio 156): solo cuentan los comprobantes
 * nacidos de un cobro (`cobro_id` no nulo).
 */
/**
 * La `ParteCalculada` sin la marca `valida` que `calcularParte` agrega a su resultado. Facturación guarda la parte sin
 * ella; esto también limpia las filas que se hubieran guardado con la marca.
 */
export function sinMarcaDeValida(guardada: ParteCalculada): ParteCalculada {
  const { valida: _valida, ...parte } = guardada as ParteCalculada & { valida?: true };
  return parte;
}

@Injectable()
export class FacturadoService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  async facturadoDeOrden(ordenId: string): Promise<ParteCalculada[]> {
    const filas = await this.conexion.query<{ detalle_parte: ParteCalculada }>(
      `SELECT detalle_parte FROM comprobante
        WHERE orden_id = $1 AND cobro_id IS NOT NULL AND detalle_parte IS NOT NULL
        ORDER BY numero_parte`,
      { bind: [ordenId], type: QueryTypes.SELECT },
    );
    return filas.map((f) => sinMarcaDeValida(f.detalle_parte));
  }

  /**
   * La parte de cada comprobante dado (`detalle_parte`), por su id: para la cuenta (`cobros[].detalleParte`). Es la
   * misma `ParteCalculada` que devuelve `facturadoDeOrden`, sin la marca `valida`.
   */
  async detalleDeComprobantes(ids: readonly string[]): Promise<Map<string, ParteCalculada>> {
    if (ids.length === 0) return new Map();
    const filas = await this.conexion.query<{ id: string; detalle_parte: ParteCalculada }>(
      `SELECT id, detalle_parte FROM comprobante
        WHERE id = ANY($1::uuid[]) AND detalle_parte IS NOT NULL`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    return new Map(filas.map((f) => [f.id, sinMarcaDeValida(f.detalle_parte)] as const));
  }
}
