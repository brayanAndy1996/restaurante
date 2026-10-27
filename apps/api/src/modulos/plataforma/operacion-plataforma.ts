import { Injectable } from '@nestjs/common';
import type { OpcionesOperacionPlataforma, TransaccionPlataforma } from './tipos';

/**
 * Operaciones del superadministrador que no pertenecen a una empresa. Usa la conexión de
 * `restaurante_plataforma`, abre una transacción, corre `fn` y escribe la fila de auditoría en esa
 * misma transacción: o queda el cambio con su auditoría, o no queda nada.
 *
 * FASE A: solo la firma pública; la implementación llega en la tarea T14.
 */
@Injectable()
export class OperacionPlataforma {
  async ejecutar<T>(
    _opciones: OpcionesOperacionPlataforma,
    _fn: (transaccion: TransaccionPlataforma) => Promise<T>,
  ): Promise<T> {
    throw new Error('No implementado');
  }
}
