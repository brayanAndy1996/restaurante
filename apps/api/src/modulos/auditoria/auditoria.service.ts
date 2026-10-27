import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import type { EntradaAuditoria, EntradaAuditoriaPlataforma } from './tipos';

/**
 * Auditoría general (RF-13, RNF-09): una tabla inmutable con quién hizo qué. Sus firmas están fijadas;
 * la lógica llega con la tarea T8 (hasta entonces lanzan `Error('No implementado')`).
 */
@Injectable()
export class AuditoriaService {
  /**
   * Registra una fila dentro del contexto de empresa de la petición, en la misma transacción que el
   * cambio que audita.
   */
  async registrar(_entrada: EntradaAuditoria): Promise<void> {
    throw new Error('No implementado');
  }
}

/**
 * Inserta una fila de origen plataforma con la transacción que recibe (la de
 * `OperacionPlataforma`, que ya fijó su actor). Es una función y no un proveedor para evitar
 * dependencias circulares entre módulos.
 */
export async function insertarAuditoriaPlataforma(
  _transaccion: Transaction,
  _entrada: EntradaAuditoriaPlataforma,
): Promise<void> {
  throw new Error('No implementado');
}
