import { HttpException } from '@nestjs/common';
import type { CampoError, CodigoError, SeQuita, UsadoEn } from '@restaurante/contratos';
import type { ZodError } from 'zod';

/**
 * Datos extra de un 409 de la carta (historia 003, criterios 10b y 10c): `usadoEn` solo en `EN_USO` de un
 * cambio de tipo y `seQuita` solo en `CONFIRMACION_REQUERIDA`.
 */
export interface DetalleDeError {
  usadoEn?: UsadoEn;
  seQuita?: SeQuita;
}

/** Error de negocio con código estable; el filtro global lo responde como `{ codigo, mensaje, campos? }`. */
export class ErrorAplicacion extends HttpException {
  constructor(
    estado: number,
    readonly codigo: CodigoError,
    mensaje: string,
    readonly campos?: CampoError[],
    /** Solo en 429 (`BLOQUEO_TEMPORAL`, `DEMASIADAS_PETICIONES`): segundos que faltan; el filtro lo pone también en `Retry-After`. */
    readonly reintentarEnSegundos?: number,
    /** Solo en los 409 del cambio de tipo de un producto (criterios 10b y 10c de 003). */
    readonly detalle?: DetalleDeError,
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
