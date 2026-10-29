import { createHash } from 'node:crypto';
import type { EnvioEntradaValidada, MarchaEntrada } from '@restaurante/contratos';
import { jsonCanonico } from '../../nucleo/idempotencia';

/**
 * Huellas de las entradas de un envío y de una marcha (historia 004, criterios 26 y 32): SHA-256 de la entrada
 * **normalizada**, así el mismo pedido escrito de otra forma (ids en mayúsculas, modificadores en otro orden,
 * valores por defecto escritos) da la misma huella. La huella se guarda con el envío o la marcha y sirve para
 * reconocer la réplica por su id de cliente (con otra clave de idempotencia o desde otra sesión): igual huella y
 * misma orden, la misma petición; si no, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
 *
 * La orden no va en la huella: se compara aparte con la orden del envío o la marcha guardados.
 */

/** Una línea de envío normalizada: ids en minúsculas, modificadores ordenados, valores por defecto aplicados. */
export interface LineaNormalizada {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  observacion: string | null;
  tiempo: 1 | 2;
  paraLlevar: boolean;
}

export function normalizarLineas(lineas: EnvioEntradaValidada['lineas']): LineaNormalizada[] {
  return lineas.map((linea) => ({
    productoId: linea.productoId.toLowerCase(),
    modificadorIds: linea.modificadorIds.map((id) => id.toLowerCase()).sort(),
    cantidad: linea.cantidad,
    observacion: linea.observacion ?? null,
    tiempo: linea.tiempo,
    paraLlevar: linea.paraLlevar,
  }));
}

const sha256 = (texto: string): Buffer => createHash('sha256').update(texto, 'utf8').digest();

/** Huella de las líneas de un envío (en el orden en que se enviaron: el orden de los ítems es parte del pedido). */
export const huellaDeEnvio = (lineas: readonly LineaNormalizada[]): Buffer =>
  sha256(jsonCanonico({ lineas }));

/**
 * Huella de una marcha: `itemIds` ordenados y en minúsculas, o `null` si se pidieron todos los ítems por marchar
 * (pedir "todos" y nombrar los ítems son pedidos distintos aunque hoy coincidan).
 */
export const huellaDeMarcha = (itemIds: MarchaEntrada['itemIds']): Buffer =>
  sha256(
    jsonCanonico({
      itemIds: itemIds === undefined ? null : itemIds.map((id) => id.toLowerCase()).sort(),
    }),
  );
