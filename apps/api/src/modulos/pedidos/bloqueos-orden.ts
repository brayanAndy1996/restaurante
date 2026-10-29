import { QueryTypes, type Sequelize } from 'sequelize';
import { ordenNoAbierta, ordenNoEncontrada } from './errores-pedidos';

/** La orden bloqueada para una escritura, con lo que hace falta para decidir si se puede seguir. */
export interface OrdenBloqueada {
  id: string;
  sucursalId: string;
  estado: 'ABIERTA' | 'EN_PRECUENTA' | 'ANULADA' | 'UNIDA' | 'CERRADA';
  comensales: number;
  /** La orden a la que se unió, si quedó `UNIDA`. */
  unidaA: string | null;
}

interface FilaOrdenBloqueada {
  id: string;
  sucursal_id: string;
  estado: OrdenBloqueada['estado'];
  comensales: number;
  unida_a_orden_id: string | null;
}

/**
 * Bloquea la orden (`SELECT … FOR UPDATE`) de la sucursal activa y la devuelve. Serializa los envíos, marchas,
 * anulaciones, uniones y pre-cuentas de la misma orden (plan, "Enviar"). 404 si no existe, es de otra sucursal
 * o de otra empresa (la RLS la oculta): los tres dan el mismo cuerpo (criterio 85).
 */
export async function bloquearOrden(
  conexion: Sequelize,
  ordenId: string,
  sucursalId: string,
): Promise<OrdenBloqueada> {
  const filas = await conexion.query<FilaOrdenBloqueada>(
    `SELECT id, sucursal_id, estado, comensales, unida_a_orden_id FROM orden
      WHERE id = $1 AND sucursal_id = $2 FOR UPDATE`,
    { bind: [ordenId, sucursalId], type: QueryTypes.SELECT },
  );
  const fila = filas[0];
  if (fila === undefined) throw ordenNoEncontrada();
  return {
    id: fila.id,
    sucursalId: fila.sucursal_id,
    estado: fila.estado,
    comensales: fila.comensales,
    unidaA: fila.unida_a_orden_id,
  };
}

/**
 * Bloquea varias órdenes de la sucursal activa en una sola consulta, ordenadas por id (`FOR UPDATE`), para que
 * dos operaciones que toman las mismas órdenes (por ejemplo, dos uniones cruzadas) las tomen en el mismo orden
 * y no se esperen una a la otra (plan, "Mover y unir"). Devuelve las que existen en la sucursal por id; quien
 * llama decide qué hacer con las que faltan. Las órdenes se toman siempre antes que las mesas.
 */
export async function bloquearOrdenes(
  conexion: Sequelize,
  ordenIds: readonly string[],
  sucursalId: string,
): Promise<Map<string, OrdenBloqueada>> {
  const ids = [...new Set(ordenIds)].sort();
  const filas = await conexion.query<FilaOrdenBloqueada>(
    `SELECT id, sucursal_id, estado, comensales, unida_a_orden_id FROM orden
      WHERE id = ANY($1::uuid[]) AND sucursal_id = $2 ORDER BY id FOR UPDATE`,
    { bind: [ids, sucursalId], type: QueryTypes.SELECT },
  );
  return new Map(
    filas.map((fila): [string, OrdenBloqueada] => [
      fila.id,
      {
        id: fila.id,
        sucursalId: fila.sucursal_id,
        estado: fila.estado,
        comensales: fila.comensales,
        unidaA: fila.unida_a_orden_id,
      },
    ]),
  );
}

/**
 * La orden debe estar abierta (`ABIERTA` o `EN_PRECUENTA`): `ANULADA` o `CERRADA`, 409 `ORDEN_NO_ABIERTA`;
 * `UNIDA`, 409 con la orden a la que se unió para que la PWA lleve ahí al mozo (criterio 29).
 */
export function exigirOrdenAbierta(orden: OrdenBloqueada): void {
  if (orden.estado !== 'ABIERTA' && orden.estado !== 'EN_PRECUENTA') {
    throw ordenNoAbierta(orden.estado === 'UNIDA' ? orden.unidaA : null);
  }
}
