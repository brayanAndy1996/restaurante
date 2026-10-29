import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * Errores del módulo de pedidos (historia 004). Un id de otra empresa, de otra sucursal y uno inexistente dan
 * exactamente el mismo cuerpo (criterio 85): el mensaje nunca lleva el id.
 */

/** 404 de una orden de otra sucursal, de otra empresa o inexistente. */
export const ordenNoEncontrada = (): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La orden no existe');

/** 409 `MESA_OCUPADA` con la orden que ocupa la mesa, para que la PWA lleve a la persona ahí (criterio 11). */
export const mesaOcupada = (ordenId: string): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'MESA_OCUPADA',
    'La mesa ya tiene una orden abierta',
    undefined,
    undefined,
    {
      ordenId,
    },
  );

/**
 * 409 `ORDEN_NO_ABIERTA`. Si la orden se unió a otra (`UNIDA`), lleva `ordenId` de la orden a la que se unió
 * (criterio 29), para que la PWA lleve al mozo ahí.
 */
export const ordenNoAbierta = (unidaA: string | null = null): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'ORDEN_NO_ABIERTA',
    'La orden ya no está abierta',
    undefined,
    undefined,
    unidaA === null ? undefined : { ordenId: unidaA },
  );

/** 409 `CONFLICTO` por una mesa que no se puede usar (inactiva). */
export const mesaInactiva = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'La mesa está inactiva', [
    { campo: 'mesaId', mensaje: 'La mesa está inactiva' },
  ]);

/** 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`: el mismo id de cliente con otra mesa, otro cuerpo u otra orden. */
export const idDeClienteReutilizado = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    'El identificador ya se usó con otra petición',
  );

/** 422 `REFERENCIA_INVALIDA` por una persona que no atiende mesas; igual para una de B y una inexistente. */
export const mozoInvalido = (mensaje: string): ErrorAplicacion => {
  const campos: CampoError[] = [{ campo: 'mozoId', mensaje }];
  return new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    campos,
  );
};
