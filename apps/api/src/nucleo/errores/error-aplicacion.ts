import { HttpException } from '@nestjs/common';
import type { CampoError, CodigoError } from '@restaurante/contratos';
import type { ZodError } from 'zod';

/** Error de negocio con código estable; el filtro global lo responde como `{ codigo, mensaje, campos? }`. */
export class ErrorAplicacion extends HttpException {
  constructor(
    estado: number,
    readonly codigo: CodigoError,
    mensaje: string,
    readonly campos?: CampoError[],
  ) {
    super(mensaje, estado);
  }
}

/** 400 DATOS_INVALIDOS a partir de un error de zod, con la lista de campos. */
export function errorDatosInvalidos(error: ZodError): ErrorAplicacion {
  const campos = error.issues.map((issue) => ({
    campo: issue.path.join('.'),
    mensaje: issue.message,
  }));
  return new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', campos);
}
