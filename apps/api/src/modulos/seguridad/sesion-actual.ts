import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores/no-implementado';
import { principalActual, type Principal } from '../../nucleo/principal';
import type { AutorizacionConsumida } from './autorizacion.service';

/**
 * Acceso al principal de la petición en curso (quién hace la petición): tipo de sesión, empresa, persona,
 * sucursal activa, rol, equipo y si debe cambiar la contraseña. Lo calcula el guard de autenticación en
 * cada petición y lo guarda el `PrincipalInterceptor`; no lo envía el cliente. Fuera de una petición
 * autenticada (rutas públicas, scripts, tareas) lanza error.
 */
@Injectable()
export class SesionActual {
  principal(): Principal {
    const principal = principalActual();
    if (principal === undefined) {
      throw new Error(
        'No hay un principal: la operación no corre dentro de una petición autenticada',
      );
    }
    return principal;
  }

  /** El principal, o `undefined` fuera de una petición autenticada. */
  principalOpcional(): Principal | undefined {
    return principalActual();
  }

  /**
   * La autorización de supervisor que `@Permiso` consumió en esta petición, o `undefined` si la acción no la
   * necesitó (historia 004, criterio 41): para la fila de auditoría de la acción y el `autorizadoPor` de la
   * respuesta. La guarda `PermisoInterceptor` al consumirla; una réplica de la misma clave no la consume.
   *
   * Fase A: solo la firma; lanza `Error('No implementado')` hasta la tarea T22.
   */
  autorizacionConsumida(): (AutorizacionConsumida & { autorizacionId: string }) | undefined {
    throw noImplementado();
  }
}
