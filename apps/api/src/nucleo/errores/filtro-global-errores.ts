import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { CodigoError, ErrorRespuesta } from '@restaurante/contratos';
import type { Response } from 'express';
import { ErrorAplicacion } from './error-aplicacion';

/** Códigos que el filtro asigna por estado HTTP a un 4xx que no es un `ErrorAplicacion`. */
type CodigoDe4xx = Extract<
  CodigoError,
  | 'DATOS_INVALIDOS'
  | 'NO_AUTENTICADO'
  | 'PROHIBIDO'
  | 'NO_ENCONTRADO'
  | 'METODO_NO_PERMITIDO'
  | 'CONFLICTO'
  | 'CUERPO_DEMASIADO_GRANDE'
  | 'TIPO_NO_SOPORTADO'
  | 'DEMASIADAS_PETICIONES'
  | 'PETICION_INVALIDA'
>;

/**
 * Código de error por estado HTTP 4xx (criterio 40d). Los que no están aquí (406, 408, 410, 418…)
 * responden `PETICION_INVALIDA`. Los 422 los lanzan los servicios con su propio código
 * (`EMISOR_INVALIDO`) como `ErrorAplicacion`, y no pasan por esta tabla.
 */
const CODIGO_POR_ESTADO: Record<number, CodigoDe4xx> = {
  400: 'DATOS_INVALIDOS',
  401: 'NO_AUTENTICADO',
  403: 'PROHIBIDO',
  404: 'NO_ENCONTRADO',
  405: 'METODO_NO_PERMITIDO',
  409: 'CONFLICTO',
  413: 'CUERPO_DEMASIADO_GRANDE',
  415: 'TIPO_NO_SOPORTADO',
  429: 'DEMASIADAS_PETICIONES',
};
const CODIGO_4XX_GENERICO: CodigoDe4xx = 'PETICION_INVALIDA';

/**
 * Mensaje fijo por código para los 4xx que no son `ErrorAplicacion`: nunca repite el texto de la
 * excepción, la ruta, el método, el cuerpo, el charset ni la codificación (criterio 40d).
 */
const MENSAJE_POR_CODIGO: Record<CodigoDe4xx, string> = {
  DATOS_INVALIDOS: 'Los datos enviados no son válidos',
  NO_AUTENTICADO: 'Se requiere autenticación para esta operación',
  PROHIBIDO: 'No tienes permiso para realizar esta operación',
  NO_ENCONTRADO: 'El recurso solicitado no existe',
  METODO_NO_PERMITIDO: 'El método de la petición no está permitido para este recurso',
  CONFLICTO: 'La operación entra en conflicto con el estado actual del recurso',
  CUERPO_DEMASIADO_GRANDE: 'El cuerpo de la petición supera el límite de 100 KB',
  TIPO_NO_SOPORTADO: 'El tipo de contenido de la petición no está soportado',
  DEMASIADAS_PETICIONES: 'Demasiadas peticiones; intenta de nuevo más tarde',
  PETICION_INVALIDA: 'La petición no se puede procesar',
};

/** Límite del cuerpo de una petición (criterio 40b); lo aplica el analizador de cuerpos de `aplicacion.ts`. */
export const LIMITE_CUERPO_BYTES = 100 * 1024;
export const MENSAJE_CUERPO_DEMASIADO_GRANDE =
  'El cuerpo de la petición supera el límite de 100 KB';

/**
 * El analizador de cuerpos de Express (body-parser) lanza `PayloadTooLargeError` (status 413, tipo
 * `entity.too.large`) antes de llegar a Nest: no es una `HttpException` y sin esta regla acabaría
 * como un 500. Se reconoce por su forma y no por la clase, que vive en un paquete interno.
 */
function esCuerpoDemasiadoGrande(excepcion: unknown): boolean {
  if (typeof excepcion !== 'object' || excepcion === null) return false;
  const { type, status, statusCode } = excepcion as Record<string, unknown>;
  return type === 'entity.too.large' || status === 413 || statusCode === 413;
}

/**
 * Estado 4xx de una excepción, o `undefined` si no es un 4xx: una `HttpException` (de Nest: guards,
 * pipes, interceptores, controladores y el enrutador) o un error con la forma de `http-errors` que
 * lanzan el analizador de cuerpos y otros middlewares de Express (`status` o `statusCode` enteros;
 * por ejemplo el 415 de `charset.unsupported` y `encoding.unsupported`). Se reconoce por su forma y
 * no por la clase, que vive en un paquete interno. Un error interno con esa forma por casualidad
 * respondería un 4xx genérico, pero el mensaje es siempre fijo y el detalle no sale de la API.
 */
function estado4xxDe(excepcion: unknown): number | undefined {
  let estado: unknown;
  if (excepcion instanceof HttpException) {
    estado = excepcion.getStatus();
  } else if (typeof excepcion === 'object' && excepcion !== null) {
    const { status, statusCode } = excepcion as Record<string, unknown>;
    estado = Number.isInteger(status) ? status : statusCode;
  }
  return typeof estado === 'number' && Number.isInteger(estado) && estado >= 400 && estado <= 499
    ? estado
    : undefined;
}

export const MENSAJE_CUERPO_MAL_FORMADO = 'El cuerpo de la petición no tiene un formato válido';

/**
 * El analizador de cuerpos de Express lanza un error de tipo `entity.parse.failed` cuando el cuerpo
 * JSON está mal formado. Es un `SyntaxError` con el texto del analizador de JSON de Node (el fallo, la
 * posición, a veces un fragmento del cuerpo), y Nest lo convierte en un `BadRequestException` con ese
 * mismo texto antes de que llegue al filtro: por eso se traduce antes, en un middleware de errores
 * que `crearAplicacion` registra justo después de los analizadores (criterio 40c). Cualquier otro
 * error se devuelve igual.
 */
export function traducirErrorDeCuerpo(error: unknown): unknown {
  const malFormado =
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>).type === 'entity.parse.failed';
  return malFormado
    ? new ErrorAplicacion(400, 'DATOS_INVALIDOS', MENSAJE_CUERPO_MAL_FORMADO)
    : error;
}

/**
 * Convierte cualquier excepción en `{ codigo, mensaje, campos? }`. Los errores no previstos
 * responden 500 genérico: nunca se devuelve el mensaje interno ni el detalle de PostgreSQL.
 */
@Catch()
export class FiltroGlobalErrores implements ExceptionFilter {
  private readonly logger = new Logger(FiltroGlobalErrores.name);

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    const { estado, cuerpo } = this.traducir(excepcion);
    respuesta.status(estado).json(cuerpo);
  }

  private traducir(excepcion: unknown): { estado: number; cuerpo: ErrorRespuesta } {
    if (excepcion instanceof ErrorAplicacion) {
      const cuerpo: ErrorRespuesta = { codigo: excepcion.codigo, mensaje: excepcion.message };
      if (excepcion.campos) cuerpo.campos = excepcion.campos;
      return { estado: excepcion.getStatus(), cuerpo };
    }
    if (esCuerpoDemasiadoGrande(excepcion)) {
      return {
        estado: 413,
        cuerpo: { codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: MENSAJE_CUERPO_DEMASIADO_GRANDE },
      };
    }
    const estado = estado4xxDe(excepcion);
    if (estado !== undefined) {
      const codigo = CODIGO_POR_ESTADO[estado] ?? CODIGO_4XX_GENERICO;
      return { estado, cuerpo: { codigo, mensaje: MENSAJE_POR_CODIGO[codigo] } };
    }
    this.logger.error(
      excepcion instanceof Error ? (excepcion.stack ?? excepcion.message) : String(excepcion),
    );
    return {
      estado: 500,
      cuerpo: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' },
    };
  }
}
