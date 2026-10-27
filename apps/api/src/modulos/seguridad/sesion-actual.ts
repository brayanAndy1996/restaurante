import { Injectable } from '@nestjs/common';
import { noImplementado } from '../../nucleo/errores';
import type { Principal } from '../../nucleo/principal';

/**
 * Acceso al principal de la petición en curso (quién hace la petición). Fuera de una petición
 * autenticada lanza error. Lógica en la tarea T10 (hasta entonces lanza `Error('No implementado')`).
 */
@Injectable()
export class SesionActual {
  principal(): Principal {
    return noImplementado();
  }
}
