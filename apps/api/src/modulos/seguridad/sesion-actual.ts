import { Injectable } from '@nestjs/common';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import {
  autorizacionConsumidaActual,
  principalActual,
  type Principal,
} from '../../nucleo/principal';
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

  /**
   * La sucursal activa de la sesión. Las rutas de sucursal ya exigen una (`@RequiereModulo`, `@RequiereSucursal`);
   * sin ella, 409 `SUCURSAL_NO_ELEGIDA`. Es el único lugar donde se decide, para que ninguna operación de pedidos
   * pueda correr sin sucursal por un olvido.
   */
  sucursalActiva(): string {
    const sucursalId = this.principal().sucursalId;
    if (sucursalId === null) {
      throw new ErrorAplicacion(409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para continuar');
    }
    return sucursalId;
  }

  /** El principal, o `undefined` fuera de una petición autenticada. */
  principalOpcional(): Principal | undefined {
    return principalActual();
  }

  /**
   * La autorización de supervisor que `@Permiso` consumió en esta petición, o `undefined` si la acción no la
   * necesitó (historia 004, criterio 41): para la fila de auditoría de la acción y el `autorizadoPor` de la
   * respuesta. La guarda `PermisoInterceptor` al consumirla; una réplica de la misma clave no la consume. Es
   * propia de cada petición: nunca se ve desde otra.
   */
  autorizacionConsumida(): (AutorizacionConsumida & { autorizacionId: string }) | undefined {
    return autorizacionConsumidaActual();
  }
}
