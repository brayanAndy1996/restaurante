import { HttpException } from '@nestjs/common';
import type { CampoError, CodigoError, SeQuita, UsadoEn } from '@restaurante/contratos';
import type { EstadoLlamado } from '@restaurante/dominio';
import type { ZodError } from 'zod';

/**
 * Datos extra de un 409: de la carta (historia 003, criterios 10b y 10c), `usadoEn` solo en `EN_USO` de un cambio
 * de tipo y `seQuita` solo en `CONFIRMACION_REQUERIDA`; de los pedidos (historia 004, criterios 11 y 29),
 * `ordenId` en `MESA_OCUPADA` (la orden que ocupa la mesa) y en `ORDEN_NO_ABIERTA` cuando la orden se unió a otra.
 */
export interface DetalleDeError {
  usadoEn?: UsadoEn;
  seQuita?: SeQuita;
  ordenId?: string;
  /** Solo en `LLAMADO_TOMADO` (historia 005, criterio 43): quién ya está atendiendo el llamado. */
  atendidoPor?: { id: string; nombre: string };
  /** Solo en `LLAMADO_CERRADO` (historia 005, criterios 44 y 53): el estado en que quedó el llamado. */
  estado?: EstadoLlamado;
}

/** Opciones de un `ErrorAplicacion` que no son parte de su respuesta HTTP. */
export interface OpcionesDeError {
  /** Ver `ErrorAplicacion.conservarCambios`. */
  conservarCambios?: boolean;
}

/** Error de negocio con código estable; el filtro global lo responde como `{ codigo, mensaje, campos? }`. */
export class ErrorAplicacion extends HttpException {
  /**
   * Solo de lectura y fijado al construir el error (opción `conservarCambios`), nunca después. Si es `true`, la
   * petición responde este error **pero confirma** lo que ya escribió (en lugar de revertirlo):
   * `ContextoEmpresa.ejecutar` hace `COMMIT` y la idempotencia libera la clave. Solo para el caso de que el rechazo
   * deba dejar constancia en la base, como guardar un llamado vencido al intentar atenderlo (historia 005, criterio
   * 44). Quien lo usa escribe únicamente lo que quiere conservar antes de lanzarlo: cualquier otro cambio de la
   * petición también se confirmaría. Los eventos registrados con `alConfirmar` no se publican.
   */
  readonly conservarCambios: boolean;

  constructor(
    estado: number,
    readonly codigo: CodigoError,
    mensaje: string,
    readonly campos?: CampoError[],
    /** Solo en 429 (`BLOQUEO_TEMPORAL`, `DEMASIADAS_PETICIONES`): segundos que faltan; el filtro lo pone también en `Retry-After`. */
    readonly reintentarEnSegundos?: number,
    /** Solo en los 409 del cambio de tipo de un producto (criterios 10b y 10c de 003). */
    readonly detalle?: DetalleDeError,
    opciones: OpcionesDeError = {},
  ) {
    super(mensaje, estado);
    this.conservarCambios = opciones.conservarCambios === true;
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
