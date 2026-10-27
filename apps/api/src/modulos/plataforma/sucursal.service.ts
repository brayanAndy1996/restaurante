import { Injectable } from '@nestjs/common';
import type { SucursalConfigurarEntrada, SucursalRespuesta } from '@restaurante/contratos';

/**
 * Sucursales de la empresa del contexto activo (RF-02). Debe llamarse dentro de
 * `ContextoEmpresa.ejecutar`.
 *
 * FASE A: solo las firmas públicas; la implementación llega en la tarea T15.
 */
@Injectable()
export class SucursalService {
  async listar(): Promise<SucursalRespuesta[]> {
    throw new Error('No implementado');
  }

  /** `null` si no existe o es de otra empresa (se tratan igual). */
  async obtener(_id: string): Promise<SucursalRespuesta | null> {
    throw new Error('No implementado');
  }

  /** Aplica cambios absolutos (idempotente). Errores: 404, 409 `CONFLICTO`, 422 `EMISOR_INVALIDO`. */
  async configurar(_id: string, _cambios: SucursalConfigurarEntrada): Promise<SucursalRespuesta> {
    throw new Error('No implementado');
  }
}
