import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENTE = 'idempotente';

/**
 * Marca una ruta de escritura que acepta la cabecera `Idempotency-Key` (criterio 85): repetir la
 * petición con la misma clave y el mismo cuerpo devuelve la respuesta guardada sin repetir el efecto.
 * Por ahora solo deja la marca; el interceptor que la aplica llega con la tarea T17.
 */
export const Idempotente = () => SetMetadata(IDEMPOTENTE, true);
