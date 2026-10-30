import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * 404 con un mensaje fijo por entidad. Un id de otra empresa, de otra sucursal y uno inexistente dan exactamente
 * el mismo cuerpo (criterios 100 y 132): el mensaje nunca lleva el id.
 */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/**
 * 422 por una impresora que no existe en la sucursal o no está activa (como destino o como impresora de caja).
 * Igual para una de otra empresa, una de otra sucursal, una inactiva y una inexistente.
 */
export const impresoraInvalida = (): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    [{ campo: 'impresoraId', mensaje: 'Debe ser una impresora activa de esta sucursal' }],
  );

/** 409 por un nombre de impresora repetido en la sucursal (índice único por `lower(nombre)`). */
export const nombreRepetido = (): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', 'Ya existe una impresora con ese nombre en la sucursal', [
    { campo: 'nombre', mensaje: 'Ya existe una impresora con ese nombre' },
  ] satisfies CampoError[]);

/** 409 al desactivar una impresora que es destino de una estación o la impresora de caja (criterio 104). */
export const impresoraEnUso = (usos: readonly string[]): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'EN_USO',
    `La impresora se usa como ${usos.join(' y como ')}. Cámbialo antes de desactivarla`,
  );

/** 409 `SIN_IMPRESORA`: no hay una impresora activa donde reimprimir el trabajo (criterio 128). */
export const sinImpresora = (): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'SIN_IMPRESORA',
    'No hay una impresora activa donde reimprimir este ticket',
  );

/**
 * 409 `CONFLICTO` por pasar del máximo de impresoras activas de una sucursal (`MAXIMO_IMPRESORAS_LATIDO`, el que
 * acepta el latido del puente). Desactiva una que ya no uses para crear otra.
 */
export const limiteDeImpresoras = (maximo: number): ErrorAplicacion =>
  new ErrorAplicacion(
    409,
    'CONFLICTO',
    `La sucursal ya tiene ${maximo} impresoras activas, que es el máximo. Desactiva una que no uses antes de agregar otra`,
  );
