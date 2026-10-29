import { Injectable } from '@nestjs/common';
import type { Rol } from '@restaurante/dominio';
import { noImplementado } from '../../nucleo/errores/no-implementado';

/** Una sesión que pasó la validación. */
export interface SesionValidada {
  empresaId: string;
  sesionId: string;
  usuarioId: string | null;
  /** La sucursal activa, o `null` si todavía no eligió una. */
  sucursalId: string | null;
  /** El rol en la sucursal activa (`ADMINISTRADOR` sin sucursal), o `null` si no tiene. */
  rol: Rol | null;
}

export interface OpcionesValidacion {
  /** `false` valida sin renovar la inactividad de la sesión (como `X-Actividad: segundo-plano`). */
  renovar: boolean;
}

/**
 * La validación de un token de sesión que hoy hace el resolutor de HTTP (historia 004, plan "Tiempo real"),
 * extraída para que Socket.IO aplique exactamente las mismas reglas: token `se.…` válido y no expirado, equipo
 * obligatorio y del mismo equipo en una sesión de PIN, contraseña no temporal, y el tiempo de inactividad que
 * rige para el rol (`minutosDeInactividad`, criterios 63b y 64).
 *
 * Fase A: solo las firmas; lanzan `Error('No implementado')` hasta la tarea T10.
 */
@Injectable()
export class ValidadorDeSesion {
  /** Valida el token (y el equipo, si lo exige la sesión) o lanza 401 con el mismo cuerpo que HTTP. */
  validar(
    token: string,
    equipo: string | undefined,
    opciones: OpcionesValidacion,
  ): Promise<SesionValidada> {
    void token;
    void equipo;
    void opciones;
    return Promise.reject(noImplementado());
  }

  /**
   * De las sesiones de una empresa, las que siguen vigentes con el reloj de la API (no cerradas, no vencidas por
   * inactividad ni por duración). Una consulta por empresa; la usa la revisión periódica de Socket.IO.
   */
  siguenValidas(empresaId: string, sesionIds: readonly string[]): Promise<Set<string>> {
    void empresaId;
    void sesionIds;
    return Promise.reject(noImplementado());
  }
}
