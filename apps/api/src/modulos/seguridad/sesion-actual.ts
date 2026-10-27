import { Injectable } from '@nestjs/common';
import { principalActual, type Principal } from '../../nucleo/principal';

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
}
