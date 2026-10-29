import type { CampoError } from '@restaurante/contratos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/**
 * 404 con un mensaje fijo por entidad. Un id de otra empresa, de otra sucursal y uno inexistente dan exactamente
 * el mismo cuerpo (criterio 85): el mensaje nunca lleva el id.
 */
export const noEncontrado = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(404, 'NO_ENCONTRADO', `${que} no existe`);

/** 400 por una regla de datos que no se puede ver en el esquema (celda fuera de la cuadrícula, orden). */
export const datosInvalidos = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', campos);

/** 422 por una referencia (`zonaId`) que no existe en la sucursal: igual para una de B y una inexistente. */
export const referenciaInvalida = (campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(
    422,
    'REFERENCIA_INVALIDA',
    'Una de las referencias no existe o no está activa',
    campos,
  );

/** 409 por un nombre repetido (índice único por `lower(nombre)`). */
export const nombreRepetido = (que: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', `Ya existe ${que} con ese nombre`, [
    { campo: 'nombre', mensaje: 'Ya existe uno con ese nombre' },
  ]);

/** 409 por un conflicto con lo guardado que no es un nombre repetido. */
export const conflicto = (mensaje: string, campos: CampoError[]): ErrorAplicacion =>
  new ErrorAplicacion(409, 'CONFLICTO', mensaje, campos);

/** 409 al desactivar algo que se está usando. */
export const enUso = (mensaje: string): ErrorAplicacion =>
  new ErrorAplicacion(409, 'EN_USO', mensaje);
