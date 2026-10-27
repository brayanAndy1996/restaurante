import { claveIdempotenciaSchema } from '@restaurante/contratos';
import type { Request } from 'express';
import { ErrorAplicacion } from '../errores/error-aplicacion';

/**
 * Valor de la cabecera `Idempotency-Key` (un UUID), o `undefined` si la petición no la trae. Una clave que
 * no es un UUID responde 400 `DATOS_INVALIDOS`.
 */
export function leerClaveIdempotencia(peticion: Request): string | undefined {
  const bruta = peticion.headers['idempotency-key'];
  if (bruta === undefined) return undefined;
  const resultado = claveIdempotenciaSchema.safeParse(Array.isArray(bruta) ? bruta[0] : bruta);
  if (!resultado.success) {
    throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'La clave de idempotencia no es válida', [
      { campo: 'Idempotency-Key', mensaje: 'Debe ser un UUID' },
    ]);
  }
  return resultado.data.toLowerCase();
}
