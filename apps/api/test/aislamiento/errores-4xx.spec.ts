// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 40d (errores 4xx): toda respuesta de error con código HTTP 4xx conserva ese código y su
// cuerpo es `{ codigo, mensaje }` (más `campos` donde ya corresponde); nunca es 500. Sea lanzado por un
// guard, un pipe, un interceptor o un controlador (sonda propia con `HttpException`), por el enrutador
// (ruta o método inexistente) o por el analizador de cuerpos antes de llegar a Nest (415 por charset o
// codificación no soportados, que no es una `HttpException`).
// - 401 NO_AUTENTICADO, 403 PROHIBIDO, 404 NO_ENCONTRADO, 405 METODO_NO_PERMITIDO, 415 TIPO_NO_SOPORTADO,
//   429 DEMASIADAS_PETICIONES y cualquier otro 4xx (406, 408, 410, 418…) PETICION_INVALIDA.
// - El mensaje es un texto genérico fijo por código: no repite el mensaje de la excepción, ni la ruta, el
//   método, el cuerpo, el charset ni la codificación.
// - Antes del controlador (ruta inexistente, analizador de cuerpos, guard) el controlador no se ejecuta.
// - Solo los errores no controlados responden 500 ERROR_INTERNO con un mensaje genérico.
// - Los errores propios de la aplicación y 400, 409 y 413 siguen igual.
import {
  Controller,
  Get,
  HttpException,
  Injectable,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
  type PipeTransform,
  type CanActivate,
} from '@nestjs/common';
import { CODIGOS_ERROR, errorRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { SinEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, fotoDeFila, type EmpresaSql } from './fabrica';

const SECRETO = 'texto-secreto-de-la-excepcion';

// --------------------------------------------------------------------------------------------------
// Sondas propias: lanzan 4xx desde un controlador, un guard, un pipe y un interceptor.
// --------------------------------------------------------------------------------------------------
const llamadas = { controlador: 0 };

@Injectable()
class GuardaProhibida implements CanActivate {
  canActivate(): boolean {
    throw new HttpException(`${SECRETO}-guarda`, 403);
  }
}

@Injectable()
class GuardaNoAutenticada implements CanActivate {
  canActivate(): boolean {
    throw new HttpException(`${SECRETO}-guarda`, 401);
  }
}

@Injectable()
class PipeNoAceptable implements PipeTransform {
  transform(): never {
    throw new HttpException(`${SECRETO}-pipe`, 406);
  }
}

@Injectable()
class InterceptorGone implements NestInterceptor {
  intercept(_contexto: ExecutionContext, _siguiente: CallHandler): never {
    throw new HttpException(`${SECRETO}-interceptor`, 410);
  }
}

@Controller('sonda-4xx')
class Sonda4xxController {
  /** Lanza una `HttpException` con el estado de la ruta y un mensaje que no debe aparecer en la respuesta. */
  @Get('lanzar/:estado')
  @SinEmpresa()
  lanzar(@Param('estado') estado: string): never {
    llamadas.controlador += 1;
    throw new HttpException(`${SECRETO}-${estado}`, Number(estado));
  }

  /** `HttpException` cuyo cuerpo es un objeto con detalles que no deben filtrarse. */
  @Get('objeto')
  @SinEmpresa()
  objeto(): never {
    llamadas.controlador += 1;
    throw new HttpException(
      { message: [`${SECRETO}-objeto`], error: 'Detalle', extra: SECRETO },
      429,
    );
  }

  @Get('guarda-prohibida')
  @SinEmpresa()
  @UseGuards(GuardaProhibida)
  guardaProhibida() {
    llamadas.controlador += 1;
    return { ok: true };
  }

  @Get('guarda-no-autenticada')
  @SinEmpresa()
  @UseGuards(GuardaNoAutenticada)
  guardaNoAutenticada() {
    llamadas.controlador += 1;
    return { ok: true };
  }

  @Get('pipe')
  @SinEmpresa()
  pipe(@Query('x', PipeNoAceptable) _x: string) {
    llamadas.controlador += 1;
    return { ok: true };
  }

  @Get('interceptor')
  @SinEmpresa()
  @UseInterceptors(InterceptorGone)
  interceptor() {
    llamadas.controlador += 1;
    return { ok: true };
  }

  /** Error no controlado: no es un 4xx. */
  @Get('no-controlado')
  @SinEmpresa()
  noControlado(): never {
    llamadas.controlador += 1;
    throw new Error(`${SECRETO}-no-controlado`);
  }

  /** Ruta de empresa sin marcar: sin cabecera responde EMPRESA_NO_RESUELTA. */
  @Get('con-empresa')
  conEmpresa() {
    llamadas.controlador += 1;
    return { ok: true };
  }
}

let app: INestApplication;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion({ controladoresExtra: [Sonda4xxController], logger: false });
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma, { emisores: 2, sucursales: 3 });
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

beforeEach(() => {
  llamadas.controlador = 0;
});

const http = () => request(app.getHttpServer());
const comoA = () => ({ 'x-empresa-id': A.id });

type Cuerpo = { codigo: string; mensaje: string; campos?: unknown };

/** El cuerpo tiene la forma `{ codigo, mensaje }` y el mensaje no repite nada de lo que se le envió. */
function exigirCuerpo(cuerpo: unknown, codigo: string, prohibidos: string[] = []): Cuerpo {
  expect(errorRespuestaSchema.safeParse(cuerpo).success, JSON.stringify(cuerpo)).toBe(true);
  expect(cuerpo).toEqual({ codigo, mensaje: expect.any(String) });
  const { mensaje } = cuerpo as Cuerpo;
  expect(mensaje.length).toBeGreaterThan(0);
  for (const texto of [SECRETO, ...prohibidos]) {
    expect(mensaje, `el mensaje repite "${texto}"`).not.toContain(texto);
    expect(JSON.stringify(cuerpo), `el cuerpo repite "${texto}"`).not.toContain(texto);
  }
  return cuerpo as Cuerpo;
}

/** Mensajes vistos por código, para comprobar que son fijos por código. */
const mensajesPorCodigo = new Map<string, Set<string>>();
function registrar(codigo: string, mensaje: string): void {
  const conjunto = mensajesPorCodigo.get(codigo) ?? new Set<string>();
  conjunto.add(mensaje);
  mensajesPorCodigo.set(codigo, conjunto);
}

describe('criterio 40d · CODIGOS_ERROR', () => {
  it('incluye los seis códigos nuevos y conserva los anteriores', () => {
    expect([...CODIGOS_ERROR]).toEqual(
      expect.arrayContaining([
        'DATOS_INVALIDOS',
        'EMPRESA_NO_RESUELTA',
        'NO_ENCONTRADO',
        'CONFLICTO',
        'EMISOR_INVALIDO',
        'CUERPO_DEMASIADO_GRANDE',
        'ERROR_INTERNO',
        'NO_AUTENTICADO',
        'PROHIBIDO',
        'METODO_NO_PERMITIDO',
        'TIPO_NO_SOPORTADO',
        'DEMASIADAS_PETICIONES',
        'PETICION_INVALIDA',
      ]),
    );
  });
});

describe('criterio 40d · 4xx lanzado por un controlador con HttpException', () => {
  const CASOS: [number, string][] = [
    [401, 'NO_AUTENTICADO'],
    [403, 'PROHIBIDO'],
    [404, 'NO_ENCONTRADO'],
    [405, 'METODO_NO_PERMITIDO'],
    [406, 'PETICION_INVALIDA'],
    [408, 'PETICION_INVALIDA'],
    [410, 'PETICION_INVALIDA'],
    [415, 'TIPO_NO_SOPORTADO'],
    [418, 'PETICION_INVALIDA'],
    [429, 'DEMASIADAS_PETICIONES'],
  ];

  it.each(CASOS)(
    '%i conserva su estado y responde %s con un mensaje genérico',
    async (estado, codigo) => {
      const res = await http().get(`/sonda-4xx/lanzar/${estado}`);
      expect(res.status, JSON.stringify(res.body)).toBe(estado);
      const cuerpo = exigirCuerpo(res.body, codigo, ['sonda-4xx', 'lanzar', 'GET']);
      registrar(codigo, cuerpo.mensaje);
      expect(llamadas.controlador).toBe(1);
    },
  );

  it('un HttpException con cuerpo de objeto (message, error y detalles) responde 429 DEMASIADAS_PETICIONES sin filtrar nada', async () => {
    const res = await http().get('/sonda-4xx/objeto');
    expect(res.status).toBe(429);
    const cuerpo = exigirCuerpo(res.body, 'DEMASIADAS_PETICIONES');
    registrar('DEMASIADAS_PETICIONES', cuerpo.mensaje);
  });
});

describe('criterio 40d · 4xx lanzado por un guard, un pipe o un interceptor', () => {
  it('un guard que lanza 403 responde 403 PROHIBIDO y el controlador no se ejecuta', async () => {
    const res = await http().get('/sonda-4xx/guarda-prohibida');
    expect(res.status).toBe(403);
    registrar('PROHIBIDO', exigirCuerpo(res.body, 'PROHIBIDO', ['guarda']).mensaje);
    expect(llamadas.controlador).toBe(0);
  });

  it('un guard que lanza 401 responde 401 NO_AUTENTICADO y el controlador no se ejecuta', async () => {
    const res = await http().get('/sonda-4xx/guarda-no-autenticada');
    expect(res.status).toBe(401);
    registrar('NO_AUTENTICADO', exigirCuerpo(res.body, 'NO_AUTENTICADO', ['guarda']).mensaje);
    expect(llamadas.controlador).toBe(0);
  });

  it('un pipe que lanza 406 responde 406 PETICION_INVALIDA y el controlador no se ejecuta', async () => {
    const res = await http().get('/sonda-4xx/pipe?x=1');
    expect(res.status).toBe(406);
    registrar('PETICION_INVALIDA', exigirCuerpo(res.body, 'PETICION_INVALIDA', ['pipe']).mensaje);
    expect(llamadas.controlador).toBe(0);
  });

  it('un interceptor que lanza 410 responde 410 PETICION_INVALIDA y el controlador no se ejecuta', async () => {
    const res = await http().get('/sonda-4xx/interceptor');
    expect(res.status).toBe(410);
    registrar(
      'PETICION_INVALIDA',
      exigirCuerpo(res.body, 'PETICION_INVALIDA', ['interceptor']).mensaje,
    );
    expect(llamadas.controlador).toBe(0);
  });
});

describe('criterio 40d · 4xx del enrutador: ruta o método sin ruta', () => {
  it.each([
    ['GET', '/no-existe'],
    ['GET', '/sucursales/ruta/que/no/existe'],
    ['POST', '/no-existe'],
    ['DELETE', '/sucursales'],
    ['PUT', '/health'],
  ] as const)('%s %s responde 404 NO_ENCONTRADO con un mensaje genérico', async (metodo, ruta) => {
    const res = await http()[metodo.toLowerCase() as 'get' | 'post' | 'delete' | 'put'](ruta);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    const cuerpo = exigirCuerpo(res.body, 'NO_ENCONTRADO', [ruta, 'Cannot', `${metodo} `]);
    registrar('NO_ENCONTRADO', cuerpo.mensaje);
  });

  it('con la cabecera de empresa la ruta inexistente responde igual', async () => {
    const res = await http().get('/no-existe').set(comoA());
    expect(res.status).toBe(404);
    exigirCuerpo(res.body, 'NO_ENCONTRADO', ['/no-existe', 'Cannot']);
  });
});

describe('criterio 40d · 415 del analizador de cuerpos (no es una HttpException)', () => {
  it('PATCH /sucursales/:id con charset=iso-8859-1 responde 415 TIPO_NO_SOPORTADO sin repetir el charset y la sucursal no cambia', async () => {
    const id = A.sucursales[0]!.id;
    const antes = await fotoDeFila(plataforma, 'sucursal', id);
    const res = await http()
      .patch(`/sucursales/${id}`)
      .set(comoA())
      .set('content-type', 'application/json; charset=iso-8859-1')
      .send(JSON.stringify({ direccion: 'Cambiada por 415' }));
    expect(res.status, JSON.stringify(res.body)).toBe(415);
    const cuerpo = exigirCuerpo(res.body, 'TIPO_NO_SOPORTADO', [
      'iso-8859-1',
      'charset',
      'unsupported',
      '/sucursales',
    ]);
    registrar('TIPO_NO_SOPORTADO', cuerpo.mensaje);
    expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
  });

  it('PATCH /sucursales/:id con un Content-Encoding no soportado responde 415 TIPO_NO_SOPORTADO sin repetirlo y la sucursal no cambia', async () => {
    const id = A.sucursales[0]!.id;
    const antes = await fotoDeFila(plataforma, 'sucursal', id);
    const res = await http()
      .patch(`/sucursales/${id}`)
      .set(comoA())
      .set('content-type', 'application/json')
      .set('content-encoding', 'codificacion-rara')
      .send(JSON.stringify({ direccion: 'Cambiada por 415' }));
    expect(res.status, JSON.stringify(res.body)).toBe(415);
    const cuerpo = exigirCuerpo(res.body, 'TIPO_NO_SOPORTADO', [
      'codificacion-rara',
      'encoding',
      'unsupported',
    ]);
    registrar('TIPO_NO_SOPORTADO', cuerpo.mensaje);
    expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
  });

  it('el analizador responde 415 antes de resolver la empresa: sin cabecera también es 415 y no 401', async () => {
    const res = await http()
      .patch(`/sucursales/${A.sucursales[0]!.id}`)
      .set('content-type', 'application/json; charset=iso-8859-1')
      .send(JSON.stringify({ direccion: 'x' }));
    expect(res.status).toBe(415);
    exigirCuerpo(res.body, 'TIPO_NO_SOPORTADO', ['iso-8859-1']);
  });

  it('en una ruta de la sonda el 415 del analizador tampoco ejecuta el controlador', async () => {
    const res = await http()
      .post('/sonda-4xx/lanzar/418')
      .set('content-type', 'application/json; charset=iso-8859-1')
      .send(JSON.stringify({ x: 1 }));
    expect(res.status).toBe(415);
    exigirCuerpo(res.body, 'TIPO_NO_SOPORTADO', ['iso-8859-1']);
    expect(llamadas.controlador).toBe(0);
  });
});

describe('criterio 40d · el mensaje es un texto genérico fijo por código', () => {
  it('cada código siempre responde el mismo mensaje, venga de donde venga el error', () => {
    for (const [codigo, mensajes] of mensajesPorCodigo) {
      expect([...mensajes], `mensajes distintos para ${codigo}`).toHaveLength(1);
    }
  });
});

describe('criterio 40d · solo los errores no controlados responden 500', () => {
  it('una excepción que no es un 4xx responde 500 ERROR_INTERNO con un mensaje genérico', async () => {
    const res = await http().get('/sonda-4xx/no-controlado');
    expect(res.status).toBe(500);
    exigirCuerpo(res.body, 'ERROR_INTERNO');
    expect(llamadas.controlador).toBe(1);
  });

  it('una HttpException 5xx tampoco filtra su mensaje', async () => {
    const res = await http().get('/sonda-4xx/lanzar/503');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toContain(SECRETO);
  });
});

describe('criterio 40d · los errores propios de la aplicación y 400, 409 y 413 siguen igual', () => {
  it('401 EMPRESA_NO_RESUELTA en una ruta de empresa sin empresa (y no NO_AUTENTICADO)', async () => {
    const res = await http().get('/sonda-4xx/con-empresa');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
    expect(llamadas.controlador).toBe(0);
    const sucursales = await http().get('/sucursales');
    expect(sucursales.status).toBe(401);
    expect(sucursales.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
  });

  it('404 NO_ENCONTRADO de una sucursal ajena es igual al de una inexistente', async () => {
    const ajena = await http().get(`/sucursales/${B.sucursales[0]!.id}`).set(comoA());
    const inexistente = await http().get(`/sucursales/${randomUUID()}`).set(comoA());
    expect(ajena.status).toBe(404);
    expect(ajena.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(ajena.body).toEqual(inexistente.body);
  });

  it('422 EMISOR_INVALIDO con el emisor de otra empresa', async () => {
    const id = A.sucursales[0]!.id;
    const res = await http()
      .patch(`/sucursales/${id}`)
      .set(comoA())
      .send({ emisorId: B.emisores[0]!.id });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'EMISOR_INVALIDO' });
  });

  it('400 DATOS_INVALIDOS con la lista de campos', async () => {
    const res = await http()
      .patch(`/sucursales/${A.sucursales[0]!.id}`)
      .set(comoA())
      .send({ nombre: '' });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    expect(Array.isArray(res.body.campos)).toBe(true);
    const noUuid = await http().get('/sucursales/no-es-uuid').set(comoA());
    expect(noUuid.status).toBe(400);
    expect(noUuid.body.codigo).toBe('DATOS_INVALIDOS');
  });

  it('400 DATOS_INVALIDOS con un JSON mal formado, con un mensaje que no repite el analizador', async () => {
    const res = await http()
      .patch(`/sucursales/${A.sucursales[0]!.id}`)
      .set(comoA())
      .set('content-type', 'application/json')
      .send('{"direccion": ');
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    expect(res.body.mensaje).not.toMatch(/Unexpected|Expected|position|token|direccion/i);
  });

  it('409 CONFLICTO con un código de establecimiento repetido del mismo emisor', async () => {
    const [s0, , s2] = A.sucursales;
    const res = await http()
      .patch(`/sucursales/${s2!.id}`)
      .set(comoA())
      .send({ codigoEstablecimiento: s0!.codigoEstablecimiento });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.codigo).toBe('CONFLICTO');
  });

  it('413 CUERPO_DEMASIADO_GRANDE con un cuerpo mayor a 100 KB', async () => {
    const res = await http()
      .patch(`/sucursales/${A.sucursales[0]!.id}`)
      .set(comoA())
      .set('content-type', 'application/json')
      .send(JSON.stringify({ direccion: 'x'.repeat(100 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ codigo: 'CUERPO_DEMASIADO_GRANDE', mensaje: expect.any(String) });
  });
});
