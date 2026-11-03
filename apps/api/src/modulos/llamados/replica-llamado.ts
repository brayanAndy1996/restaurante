import { createHash } from 'node:crypto';
import type { LlamadoEntradaValidada } from '@restaurante/contratos';
import { jsonCanonico } from '../../nucleo/idempotencia';

/**
 * Huella de la entrada de un llamado (historia 005, criterio 29): SHA-256 de la entrada **normalizada**, así el mismo
 * pedido escrito de otra forma (ids en mayúsculas, modificadores en otro orden, textos con espacios al borde) da la
 * misma huella. Se guarda con el llamado y sirve para reconocer la réplica por su `id` (desde cualquier conexión): igual
 * huella y misma mesa, la misma petición; si no, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`.
 *
 * La mesa no va en la huella: se compara aparte con la del llamado guardado. Los textos ya llegan sin espacios al
 * borde (el esquema los recorta).
 */

/** Una línea de la entrada normalizada: ids en minúsculas, modificadores ordenados. */
export interface LineaDeEntradaNormalizada {
  productoId: string;
  modificadorIds: string[];
  cantidad: number;
  observacion: string | null;
}

export interface EntradaNormalizada {
  id: string;
  tipo: LlamadoEntradaValidada['tipo'];
  lineas: LineaDeEntradaNormalizada[];
  nota: string | null;
}

export function normalizarEntrada(entrada: LlamadoEntradaValidada): EntradaNormalizada {
  if (entrada.tipo !== 'PEDIDO') {
    return { id: entrada.id.toLowerCase(), tipo: entrada.tipo, lineas: [], nota: null };
  }
  return {
    id: entrada.id.toLowerCase(),
    tipo: 'PEDIDO',
    lineas: entrada.lineas.map((linea) => ({
      productoId: linea.productoId.toLowerCase(),
      modificadorIds: linea.modificadorIds.map((id) => id.toLowerCase()).sort(),
      cantidad: linea.cantidad,
      observacion: linea.observacion ?? null,
    })),
    nota: entrada.nota ?? null,
  };
}

/** Huella de la entrada normalizada, sin el `id` (que ya identifica la fila). */
export function huellaDeEntrada(entrada: EntradaNormalizada): Buffer {
  const { tipo, lineas, nota } = entrada;
  return createHash('sha256').update(jsonCanonico({ tipo, lineas, nota }), 'utf8').digest();
}
