import { Inject, Injectable } from '@nestjs/common';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';

/** Una estación de producción vista por otros módulos. */
export interface EstacionVisible {
  id: string;
  nombre: string;
}

/**
 * Lecturas de las estaciones para otros módulos (historia 004): `carta` es dueño de `estacion` y nadie más la
 * consulta. Corren en la transacción de la empresa del contexto activo, así que la RLS limita todo a la propia
 * empresa.
 */
@Injectable()
export class CartaConsultaService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /** Las estaciones activas de la empresa del contexto, por nombre y luego por id (el KDS sin filtro y 3b). */
  estaciones(transaccion?: Transaction): Promise<EstacionVisible[]> {
    return this.conexion.query<EstacionVisible>(
      'SELECT id, nombre FROM estacion WHERE activa ORDER BY nombre, id',
      { type: QueryTypes.SELECT, transaction: transaccion },
    );
  }

  /**
   * El nombre de cada estación pedida, activa o no (una comanda enviada sigue mostrando su estación aunque
   * se desactive después), en una sola consulta. Un id de otra empresa o inexistente no aparece.
   */
  async nombres(
    estacionIds: readonly string[],
    transaccion?: Transaction,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(estacionIds.map((id) => id.toLowerCase()))];
    const filas = await this.conexion.query<EstacionVisible>(
      'SELECT id, nombre FROM estacion WHERE id = ANY($1::uuid[])',
      { bind: [ids], type: QueryTypes.SELECT, transaction: transaccion },
    );
    return new Map(filas.map((f) => [f.id, f.nombre]));
  }
}
