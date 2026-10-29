import { Inject, Injectable } from '@nestjs/common';
import type { MesaRespuesta, ZonaRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { noEncontrado } from './errores-salon';
import { COLUMNAS_MESA, aMesa, leerZonas } from './lectura-mapa';

/** Una mesa bloqueada para una operación de pedidos, con la sucursal a la que pertenece. */
export interface MesaBloqueada extends MesaRespuesta {
  sucursalId: string;
}

/**
 * Lecturas de `zona` y `mesa` para el módulo de pedidos (historia 004): `salon` es dueño de las tablas y
 * nadie más las consulta. Corren en la transacción de la empresa del contexto activo, así que la RLS limita
 * todo a la propia empresa: una mesa de otra empresa es indistinguible de una inexistente.
 */
@Injectable()
export class MesasConsultaService {
  constructor(@Inject(CONEXION_API) private readonly conexion: Sequelize) {}

  /**
   * Las zonas de la sucursal en su orden, cada una con todas sus mesas (activas e inactivas), en una cantidad
   * fija de consultas sin importar cuántas mesas haya.
   */
  listar(sucursalId: string, transaccion?: Transaction): Promise<ZonaRespuesta[]> {
    return leerZonas(this.conexion, sucursalId, { transaccion });
  }

  /**
   * Bloquea las mesas (`FOR UPDATE`, en orden de id) y las devuelve. Lanza 404 `NO_ENCONTRADO` si alguna no
   * existe o no es de la sucursal (con el mismo cuerpo para una de otra empresa). Quien lo llama decide si una
   * mesa inactiva es un error.
   */
  async bloquear(
    mesaIds: readonly string[],
    sucursalId: string,
    transaccion?: Transaction,
  ): Promise<MesaBloqueada[]> {
    const ids = [...new Set(mesaIds.map((id) => id.toLowerCase()))].sort();
    if (ids.length === 0) return [];
    const filas = await this.conexion.query<Parameters<typeof aMesa>[0] & { sucursal_id: string }>(
      `SELECT ${COLUMNAS_MESA}, m.sucursal_id FROM mesa m
        WHERE m.id = ANY($1::uuid[]) ORDER BY m.id FOR UPDATE`,
      { bind: [ids], type: QueryTypes.SELECT, transaction: transaccion },
    );
    // Una mesa de otra sucursal se trata como inexistente: la sucursal activa decide qué mesas existen.
    if (filas.length !== ids.length || filas.some((m) => m.sucursal_id !== sucursalId)) {
      throw noEncontrado('La mesa');
    }
    return filas.map((m) => ({ ...aMesa(m), sucursalId: m.sucursal_id }));
  }
}
