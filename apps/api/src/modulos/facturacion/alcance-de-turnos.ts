import { Injectable } from '@nestjs/common';
import type { Principal } from '../seguridad';

/**
 * Quién es el responsable de un turno de la sucursal activa, o `null` si no existe ahí. Facturación no lee `turno`: el
 * módulo de caja lo registra al arrancar (como `COBROS` de pedidos) para que `GET /comprobantes?turnoId=` pueda decir
 * 403 a un Cajero que pide los comprobantes de un turno ajeno incluso si ese turno todavía no emitió ninguno
 * (historia 006, criterio 100). **Falla cerrado**: sin registro, nadie es responsable de nada.
 */
export type ResolutorResponsableDeTurno = (turnoId: string) => Promise<string | null>;

@Injectable()
export class RegistroAlcanceDeTurnos {
  private resolutor: ResolutorResponsableDeTurno | null = null;

  registrar(resolutor: ResolutorResponsableDeTurno): void {
    this.resolutor = resolutor;
  }

  /** El responsable del turno en la sucursal activa, o `null` (inexistente, de otra sucursal o sin registro). */
  async responsableDe(turnoId: string): Promise<string | null> {
    if (this.resolutor === null) return null;
    return this.resolutor(turnoId);
  }
}

/** El Supervisor y el Administrador (también en soporte) ven los comprobantes de cualquier turno de la sucursal. */
export function veTodosLosTurnos(principal: Principal): boolean {
  return (
    principal.esAdministrador || principal.rol === 'SUPERVISOR' || principal.rol === 'ADMINISTRADOR'
  );
}
