import { Controller, Get, Post, Req } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { Publica } from '../../src/modulos/seguridad';
import { fijarEntornoDePrueba } from '../utilidades';
import { CABECERA_IP_DE_PRUEBA, ClientePublico } from './index';

// Infraestructura de pruebas de la historia 005 (T3): `ClientePublico`. No es una prueba protegida.

@Controller('sonda-cliente-publico')
class SondaController {
  @Get()
  @Publica()
  leer(@Req() peticion: Request) {
    return {
      ip: peticion.headers['cf-connecting-ip'] ?? null,
      origen: peticion.headers.origin ?? null,
      authorization: peticion.headers.authorization ?? null,
      equipo: peticion.headers['x-equipo'] ?? null,
    };
  }

  @Post()
  @Publica()
  escribir(@Req() peticion: Request) {
    return { cuerpo: peticion.body as unknown, ip: peticion.headers['cf-connecting-ip'] ?? null };
  }
}

describe('ClientePublico', () => {
  let app: INestApplication;

  beforeAll(async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion({ controladoresExtra: [SondaController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('la cabecera de la IP de las pruebas es la que fija fijarEntornoDePrueba', () => {
    expect(process.env.CABECERA_IP_CLIENTE).toBe(CABECERA_IP_DE_PRUEBA);
  });

  it('manda la IP elegida en la cabecera y nunca una sesión', async () => {
    const cliente = new ClientePublico(app, { ip: '203.0.113.7' });
    const res = await cliente.get('/sonda-cliente-publico');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ip: '203.0.113.7',
      origen: null,
      authorization: null,
      equipo: null,
    });
  });

  it('cada instancia sin IP elegida recibe una distinta', () => {
    const a = new ClientePublico(app);
    const b = new ClientePublico(app);
    expect(a.ip).not.toBeNull();
    expect(a.ip).not.toBe(b.ip);
    expect(a.ip).toMatch(/^198\.18\.\d+\.\d+$/);
  });

  it('conIp, conOrigen y sinIp dan otros clientes sin cambiar el original', async () => {
    const base = new ClientePublico(app, { ip: '203.0.113.1' });
    expect((await base.conIp('203.0.113.2').get('/sonda-cliente-publico')).body.ip).toBe(
      '203.0.113.2',
    );
    const conOrigen = await base.conOrigen('http://localhost:3001').get('/sonda-cliente-publico');
    expect(conOrigen.body).toMatchObject({ ip: '203.0.113.1', origen: 'http://localhost:3001' });
    expect((await base.sinIp().get('/sonda-cliente-publico')).body.ip).toBeNull();
    expect((await base.get('/sonda-cliente-publico')).body.ip).toBe('203.0.113.1');
  });

  it('permite encadenar cabeceras (por ejemplo una sesión que la ruta debe ignorar)', async () => {
    const res = await new ClientePublico(app)
      .get('/sonda-cliente-publico')
      .set('Authorization', 'Bearer x');
    expect(res.body.authorization).toBe('Bearer x');
  });

  it('post manda el cuerpo JSON con la IP', async () => {
    const res = await new ClientePublico(app, { ip: '203.0.113.9' }).post(
      '/sonda-cliente-publico',
      {
        a: 1,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ cuerpo: { a: 1 }, ip: '203.0.113.9' });
  });

  it('options hace la consulta previa de CORS con el origen', async () => {
    const res = await new ClientePublico(app)
      .conOrigen('http://localhost:5173')
      .options('/sonda-cliente-publico')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
