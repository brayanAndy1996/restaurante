import { Injectable } from '@nestjs/common';
import type {
  EmisorEntrada,
  RegistrarEmpresaEntrada,
  SucursalEntrada,
} from '@restaurante/contratos';
import type { AuditoriaPlataformaEntrada, EmpresaResumen, ResultadoRegistroEmpresa } from './tipos';

/**
 * Alta y consulta de empresas por la vía de plataforma (sin contexto de empresa). No crea la
 * suscripción (llega con RF-03).
 *
 * FASE A: solo las firmas públicas; la implementación llega en la tarea T14.
 */
@Injectable()
export class PlataformaEmpresasService {
  /** Crea empresa, emisores y sucursales en una transacción y la fila de auditoría `registrar_empresa`. */
  async registrarEmpresa(
    _datos: RegistrarEmpresaEntrada,
    _auditoria: AuditoriaPlataformaEntrada,
  ): Promise<ResultadoRegistroEmpresa> {
    throw new Error('No implementado');
  }

  /** Agrega un emisor a una empresa existente (auditoría `agregar_emisor`). */
  async agregarEmisor(
    _empresaId: string,
    _datos: EmisorEntrada,
    _auditoria: AuditoriaPlataformaEntrada,
  ): Promise<{ id: string; ruc: string }> {
    throw new Error('No implementado');
  }

  /** Agrega una sucursal a una empresa existente (auditoría `agregar_sucursal`). */
  async agregarSucursal(
    _empresaId: string,
    _datos: SucursalEntrada,
    _auditoria: AuditoriaPlataformaEntrada,
  ): Promise<{ id: string; nombre: string }> {
    throw new Error('No implementado');
  }

  async listarEmpresas(): Promise<EmpresaResumen[]> {
    throw new Error('No implementado');
  }
}
