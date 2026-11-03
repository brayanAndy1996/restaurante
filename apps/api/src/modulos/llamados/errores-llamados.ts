import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** 409 `LLAMADO_PENDIENTE` (criterio 30): la mesa ya tiene un llamado pendiente. */
export const llamadoPendiente = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'LLAMADO_PENDIENTE',
    'Ya avisamos al mozo. Cuando atienda tu mesa podrás enviar otro',
  );

/** 409 `FUERA_DE_HORARIO` (criterio 35): el local está cerrado y la mesa no tiene una cuenta abierta. */
export const fueraDeHorario = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'FUERA_DE_HORARIO', 'El local está cerrado. Habla con el personal');

/** 429 `DEMASIADOS_LLAMADOS` (criterios 32 y 33): lleva `reintentarEnSegundos` y el filtro pone `Retry-After`. */
export const demasiadosLlamados = (reintentarEnSegundos: number): ErrorAplicacion =>
  new ErrorAplicacion(
    429,
    'DEMASIADOS_LLAMADOS',
    'Enviaste muchos avisos seguidos. Espera un momento o habla con el personal',
    undefined,
    reintentarEnSegundos,
  );

/** 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` (criterio 29): el mismo `id` con otra entrada o con otra mesa. */
export const idReutilizado = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    'Ese pedido ya se envió con otro contenido. Vuelve a armarlo',
  );

/** 422 `MONTO_FUERA_DE_RANGO` (criterio 27): `lineas.<i>` por línea que pasa del tope, o `lineas` por el total. */
export const montoFueraDeRango = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(422, 'MONTO_FUERA_DE_RANGO', 'El monto supera el máximo permitido', campos);

/** 409 `CONFLICTO` por dos escrituras que chocaron (criterio 29: repetida, responde 201). */
export const conflictoDeCreacion = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CONFLICTO',
    'Otra operación se estaba aplicando a los mismos datos. Intenta de nuevo',
  );

/** 422 de las líneas rechazadas por la carta: el código de la primera y una entrada de `campos` por línea. */
export const lineasRechazadas = (
  primera: { codigo: ErrorAplicacion['codigo']; mensaje: string },
  campos: CampoError[],
): ErrorAplicacion => new ErrorAplicacion(422, primera.codigo, primera.mensaje, campos);
