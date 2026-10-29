import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { ErrorAplicacion } from '../errores/error-aplicacion';
import { leerClaveIdempotencia } from './clave';
import { Idempotente } from './idempotente.decorator';

/**
 * Exige `Idempotency-Key`: sin ella, 400 `DATOS_INVALIDOS` con `campos` en `Idempotency-Key`. Corre después de
 * `IdempotenciaInterceptor` (que sin clave no hace nada) y de los interceptores de permiso y de módulo que la
 * ruta declare más abajo, así el 400 de forma llega después de los 403 (historia 004, "Contrato").
 */
@Injectable()
export class ClaveObligatoriaInterceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    if (contexto.getType() === 'http') {
      const peticion = contexto.switchToHttp().getRequest<Request>();
      if (leerClaveIdempotencia(peticion) === undefined) {
        throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Falta la clave de idempotencia', [
          { campo: 'Idempotency-Key', mensaje: 'Es obligatoria' },
        ]);
      }
    }
    return siguiente.handle();
  }
}

/**
 * `@Idempotente()` con la cabecera `Idempotency-Key` obligatoria: las escrituras de pedidos (abrir, enviar,
 * marchar, anular, pre-cuenta) la exigen (historia 004, criterios 9, 15, 32, 35, 42, 44 y 50).
 */
export const IdempotenteObligatoria = () =>
  applyDecorators(Idempotente(), UseInterceptors(ClaveObligatoriaInterceptor));
