import { Injectable } from '@nestjs/common';

/**
 * Contexto de empresa de la operación en curso (AsyncLocalStorage + parámetro de transacción
 * `app.empresa_id`). Este archivo será el único autorizado a escribir ese parámetro (criterio 37).
 *
 * FASE A: solo la firma pública; la implementación llega en la tarea T12.
 */
@Injectable()
export class ContextoEmpresa {
  /**
   * Valida el UUID, abre una transacción en la conexión de la API, fija `app.empresa_id` como
   * primera sentencia y corre `fn` con el contexto activo. Confirma si `fn` termina bien y revierte
   * si lanza. Misma empresa dentro de un contexto activo: reutiliza la transacción; otra empresa:
   * `ContextoEmpresaConflictoError`.
   */
  async ejecutar<T>(_empresaId: string, _fn: () => Promise<T>): Promise<T> {
    throw new Error('No implementado');
  }

  /** Empresa del contexto activo; lanza `ContextoEmpresaAusenteError` si no hay contexto. */
  empresaActual(): string {
    throw new Error('No implementado');
  }
}
