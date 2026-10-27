import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { IdempotenciaInterceptor } from './idempotencia.interceptor';

export const IDEMPOTENTE = 'idempotente';

/**
 * Marca una ruta de escritura que acepta la cabecera `Idempotency-Key` (criterio 85): repetir la
 * petición con la misma clave y el mismo cuerpo devuelve la respuesta guardada sin repetir el efecto.
 * Aplica `IdempotenciaInterceptor` (dentro de la transacción de empresa del controlador). Las rutas sin
 * contexto de empresa (`@SinEmpresa()` y las de plataforma) guardan la respuesta en su propio servicio.
 */
export const Idempotente = () =>
  applyDecorators(SetMetadata(IDEMPOTENTE, true), UseInterceptors(IdempotenciaInterceptor));
