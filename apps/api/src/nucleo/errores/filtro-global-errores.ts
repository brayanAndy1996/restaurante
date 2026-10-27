import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { CodigoError, ErrorRespuesta } from '@restaurante/contratos';
import type { Response } from 'express';
import { ErrorAplicacion } from './error-aplicacion';

const CODIGO_POR_ESTADO: Record<number, CodigoError> = {
  400: 'DATOS_INVALIDOS',
  404: 'NO_ENCONTRADO',
  409: 'CONFLICTO',
};

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
    if (excepcion instanceof HttpException) {
      const estado = excepcion.getStatus();
      const codigo = CODIGO_POR_ESTADO[estado];
      if (codigo) {
        return { estado, cuerpo: { codigo, mensaje: excepcion.message } };
      }
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
