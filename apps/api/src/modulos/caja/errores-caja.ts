import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * 404 con un mensaje fijo por entidad. Un id de otra empresa, de otra sucursal y uno inexistente dan exactamente el
 * mismo cuerpo (criterio 106): el mensaje nunca lleva el id.
 */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/** 409 `CONFLICTO` por un nombre de caja repetido en la sucursal, sin distinguir mayúsculas (criterio 1). */
export const nombreDeCajaRepetido = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'Ya existe una caja con ese nombre en la sucursal', [
    { campo: 'nombre', mensaje: 'Ya existe una caja con ese nombre' },
  ] satisfies CampoError[]);

/** 409 `CONFLICTO` por pasar del máximo de cajas activas de una sucursal (criterio 1). */
export const limiteDeCajas = (maximo: number): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CONFLICTO',
    `La sucursal ya tiene ${maximo} cajas activas, que es el máximo. Desactiva una que no uses antes de agregar otra`,
  );

/** 409 `EN_USO` al desactivar una caja que tiene un turno abierto (criterio 1). */
export const cajaConTurnoAbierto = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'EN_USO',
    'La caja tiene un turno abierto: ciérralo antes de desactivarla',
  );

/**
 * 422 por una impresora que no existe en la sucursal o no está activa (criterio 2). Igual para una de otra empresa, una
 * de otra sucursal, una inactiva y una inexistente.
 */
export const impresoraDeCajaInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    [{ campo: 'impresoraId', mensaje: 'Debe ser una impresora activa de esta sucursal' }],
  );
