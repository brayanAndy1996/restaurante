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
 * La orden debe estar abierta (`ABIERTA` o `EN_PRECUENTA`): `ANULADA` o `CERRADA`, 409 `ORDEN_NO_ABIERTA`;
 * `UNIDA`, 409 con la orden a la que se unió para que la PWA lleve ahí al mozo (criterio 29).
 */
export function exigirOrdenAbierta(orden: OrdenBloqueada): void {
  if (orden.estado !== 'ABIERTA' && orden.estado !== 'EN_PRECUENTA') {
    throw ordenNoAbierta(orden.estado === 'UNIDA' ? orden.unidaA : null);
  }
}
