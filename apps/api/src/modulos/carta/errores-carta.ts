import type { CampoError, SeQuita, UsadoEn } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * Marca de las firmas de la fase A de la historia 003: la ruta o el método existe pero todavía no hace
 * nada. Cada tarea de la fase C reemplaza el `throw` por la lógica. Es un error común (no un
 * `ErrorAplicacion`), así que el filtro global lo responde como 500 `ERROR_INTERNO`.
 */
export function noImplementado(): Error {
  return new Error('No implementado');
}

/**
 * 404 con un mensaje fijo por entidad. Un id de otra empresa y uno inexistente dan exactamente el mismo
 * cuerpo (criterio 67): el mensaje nunca lleva el id.
 */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/** 422 por una referencia (id) que no existe en la empresa, de otra empresa o inactiva (criterio 9). */
export const referenciaInvalida = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    campos,
  );

/** 400 por una regla del criterio 7 o una lista de orden que no cumple (criterios 5 y 13). */
export const datosInvalidos = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', campos);

/** 409 por un nombre repetido (índice único por `lower(nombre)`). */
export const nombreRepetido = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', `Ya existe ${que} con ese nombre`, [
    { campo: 'nombre', mensaje: 'Ya existe uno con ese nombre' },
  ]);

/** 409 al desactivar algo que usan productos activos (criterios 2 y 4). */
export const enUso = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'EN_USO', mensaje);

/** 422 de la foto (criterio 14). */
export const fotoInvalida = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(422, 'FOTO_INVALIDA', mensaje);

/** 409 por un conflicto con lo guardado que no es un nombre repetido (criterio 10d). */
export const conflicto = (mensaje: string, campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', mensaje, campos);

/**
 * 409 `EN_USO` de un cambio de tipo (criterio 10c): el producto es componente de un combo o producto ligado de
 * un modificador, así que no puede pasar a `COMBO` ni a `MENU_DEL_DIA`. Lleva `usadoEn` y dice dónde se usa.
 */
export const enUsoPorCambioDeTipo = (mensaje: string, usadoEn: UsadoEn): ErrorAplicacion =>
  new ErrorAplicacion(409, 'EN_USO', mensaje, undefined, undefined, { usadoEn });

/** 409 `CONFIRMACION_REQUERIDA` (criterio 10b): el cambio de tipo quitaría algo; lleva `seQuita`. */
export const confirmacionRequerida = (mensaje: string, seQuita: SeQuita): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFIRMACION_REQUERIDA', mensaje, undefined, undefined, { seQuita });
