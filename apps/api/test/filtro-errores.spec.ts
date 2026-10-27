import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FiltroGlobalErrores } from '../src/nucleo/errores/filtro-global-errores';

// Criterio 40d (prueba del desarrollador, no protegida): solo una `HttpException` y los errores de
// `http-errors` de la petición (`expose === true` o `type` de body-parser) dan un 4xx; un error de un
// cliente HTTP saliente con `status` 4xx es un fallo interno: 500 y se registra.

function responder(excepcion: unknown) {
  const filtro = new FiltroGlobalErrores();
  const registrado = vi
    .spyOn((filtro as unknown as { logger: { error: () => void } }).logger, 'error')
    .mockImplementation(() => undefined);
  let estado = 0;
  let cuerpo: unknown;
  const respuesta = {
    status(valor: number) {
      estado = valor;
      return this;
    },
    json(valor: unknown) {
      cuerpo = valor;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => respuesta }),
  } as unknown as ArgumentsHost;
  filtro.catch(excepcion, host);
  return { estado, cuerpo, registrado };
}

class ErrorDeCliente extends Error {
  constructor(
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super('el proveedor respondió con un error');
    Object.assign(this, extra);
  }
}

describe('criterio 40d · qué es un 4xx de la petición', () => {
  it('una HttpException conserva su estado', () => {
    const { estado, cuerpo, registrado } = responder(new HttpException('x', 403));
    expect(estado).toBe(403);
    expect(cuerpo).toMatchObject({ codigo: 'PROHIBIDO' });
    expect(registrado).not.toHaveBeenCalled();
  });

  it.each([
    [
      '413 de body-parser',
      { status: 413, statusCode: 413, expose: true, type: 'entity.too.large' },
      413,
      'CUERPO_DEMASIADO_GRANDE',
    ],
    [
      '415 de http-errors',
      { status: 415, statusCode: 415, expose: true, type: 'charset.unsupported' },
      415,
      'TIPO_NO_SOPORTADO',
    ],
    ['solo statusCode con expose', { statusCode: 404, expose: true }, 404, 'NO_ENCONTRADO'],
    [
      'type de body-parser sin expose',
      { status: 400, type: 'entity.parse.failed' },
      400,
      'DATOS_INVALIDOS',
    ],
  ])('%s se traduce a su 4xx', (_n, error, estadoEsperado, codigo) => {
    const { estado, cuerpo, registrado } = responder(Object.assign(new Error('x'), error));
    expect(estado).toBe(estadoEsperado);
    expect(cuerpo).toMatchObject({ codigo });
    expect(registrado).not.toHaveBeenCalled();
  });

  it.each([
    ['axios 404', new ErrorDeCliente(404)],
    ['axios 413', new ErrorDeCliente(413)],
    ['fetch con statusCode 429', Object.assign(new Error('x'), { statusCode: 429 })],
    ['objeto plano con status 400', { status: 400 }],
    ['expose falso', Object.assign(new Error('x'), { status: 403, expose: false })],
  ])('%s (cliente HTTP saliente) responde 500 y se registra', (_n, error) => {
    const { estado, cuerpo, registrado } = responder(error);
    expect(estado).toBe(500);
    expect(cuerpo).toEqual({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' });
    expect(registrado).toHaveBeenCalledTimes(1);
  });
});
