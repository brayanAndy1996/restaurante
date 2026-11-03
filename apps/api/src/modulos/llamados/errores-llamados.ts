import type { CampoError } from '@restaurante/contratos';
import type { EstadoLlamado } from '@restaurante/dominio';
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

// ---------------------------------------------------------------------------------------------------
// La PWA del mozo: lista, atender, pasar a la cuenta y descartar (criterios 39 a 55)
// ---------------------------------------------------------------------------------------------------

/** 404 de un llamado de otra sucursal, de otra empresa o inexistente: el mismo cuerpo, sin el id (criterio 66). */
export const llamadoNoEncontrado = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El llamado no existe');

/**
 * 409 `LLAMADO_TOMADO` (criterio 43): otra persona ya lo atiende. Lleva `atendidoPor` salvo que lo haya atendido una
 * sesión de soporte (sin persona).
 */
export const llamadoTomado = (
  atendidoPor: { id: string; nombre: string } | null,
): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'LLAMADO_TOMADO',
    atendidoPor === null
      ? 'Otra persona ya está atendiendo este llamado'
      : `${atendidoPor.nombre} ya está atendiendo este llamado`,
    undefined,
    undefined,
    atendidoPor === null ? undefined : { atendidoPor },
  );

/**
 * 409 `LLAMADO_VENCIDO` (criterios 44 y 53): nadie lo atendió en 15 minutos. Conserva los cambios de la petición:
 * quien lo lanza ya guardó el llamado como `VENCIDO` y esa escritura se confirma.
 */
export const llamadoVencido = (): ErrorAplicacion => {
  const error = new ErrorAplicacion(
    409,
    'LLAMADO_VENCIDO',
    'Este llamado venció: nadie lo atendió a tiempo',
  );
  error.conservarCambios = true;
  return error;
};

/** 409 `LLAMADO_CERRADO` (criterios 44, 46, 51 y 53): ya no admite la acción; lleva el `estado` en que quedó. */
export const llamadoCerrado = (estado: EstadoLlamado): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'LLAMADO_CERRADO',
    'Este llamado ya no admite cambios',
    undefined,
    undefined,
    { estado },
  );

/** 409 `TRANSICION_INVALIDA` (criterio 46): no se puede pasar a la cuenta un llamado en este estado o de este tipo. */
export const transicionInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'TRANSICION_INVALIDA', 'Este llamado no se puede pasar a la cuenta');

/** 409 `MESA_LIBRE` (criterio 42): la mesa está libre y faltan `ordenId` o `comensales` para abrirla. */
export const mesaLibre = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'MESA_LIBRE',
    'La mesa está libre: indica cuántos comensales hay para abrirla',
  );

/** 409 `MESA_SIN_CUENTA` (criterio 48): la mesa no tiene una orden abierta donde pasar las líneas. */
export const mesaSinCuenta = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'MESA_SIN_CUENTA',
    'La mesa no tiene una cuenta abierta. Ábrela y vuelve a pasar el pedido',
  );

/** 409 `CONFLICTO` (criterio 42): la mesa del llamado está inactiva. */
export const mesaDelLlamadoInactiva = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'La mesa está inactiva', [
    { campo: 'mesaId', mensaje: 'La mesa está inactiva' },
  ]);

/** 422 `REFERENCIA_INVALIDA` (criterio 42): una sesión de soporte no puede abrir una mesa libre (no es mozo). */
export const soporteNoAbreMesas = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    [{ campo: 'mozoId', mensaje: 'Elige quién atiende la mesa' }],
  );

/** 422 `DATOS_INVALIDOS` (criterio 46): una `posicion` que no es de una línea del llamado o repetida. */
export const posicionesInvalidas = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(422, 'DATOS_INVALIDOS', 'Las líneas a pasar no son válidas', campos);
