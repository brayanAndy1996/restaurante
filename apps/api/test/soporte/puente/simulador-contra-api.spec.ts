import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { armarQrPuente } from '@restaurante/contratos';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../../src/aplicacion';
import { fijarEntornoDePrueba } from '../../utilidades';
import { ClienteTiempoReal } from '../cliente-tiempo-real';
import { ErrorProtocoloPuente, SimuladorPuente } from './index';

// Historia 004, T35 y T36: lo que el simulador recibe hoy de la API real, que en la fase A del 3b solo tiene las
// firmas de la entrega 3b ("No implementado"). Cuando T40 implemente el puente, estas comprobaciones se reemplazan
// por las del flujo completo (las protegidas de la fase B de 3b). No es una prueba protegida.

const secreto = () => randomBytes(32).toString('base64url');
const tokenVinculacion = () => `vi.${randomUUID()}.${randomUUID()}.${secreto()}`;
const tokenPuente = () => `pu.${randomUUID()}.${randomUUID()}.${secreto()}`;

describe('el simulador del puente contra la API de la fase A de 3b', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion({ tiempoReal: { habilitado: true } });
    await app.listen(0, '127.0.0.1');
    url = ClienteTiempoReal.urlDe(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('vincular con un código bien formado recibe "No implementado" (500 ERROR_INTERNO)', async () => {
    const simulador = new SimuladorPuente({ qr: armarQrPuente(url, tokenVinculacion()) });
    const error = await simulador.vincular().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorProtocoloPuente);
    expect(error).toMatchObject({ estado: 500, codigo: 'ERROR_INTERNO' });
    expect(simulador.token).toBeNull();
    expect(simulador.revocado).toBe(false);
  });

  it('vincular con algo que no es un código vi. recibe 401 NO_AUTENTICADO', async () => {
    for (const token of [
      'vi.no-es-un-codigo',
      tokenPuente(),
      `se.${randomUUID()}.${randomUUID()}.${secreto()}`,
    ]) {
      const simulador = new SimuladorPuente({ qr: armarQrPuente(url, token) });
      await expect(simulador.vincular()).rejects.toMatchObject({
        estado: 401,
        codigo: 'NO_AUTENTICADO',
      });
    }
  });

  it('las rutas del puente con un token pu. bien formado reciben "No implementado"; con otro token, 401', async () => {
    const servidor = app.getHttpServer();
    const llamar = (metodo: 'get' | 'post', ruta: string, token?: string) => {
      const base = request(servidor);
      const peticion = metodo === 'get' ? base.get(ruta) : base.post(ruta);
      return (
        token === undefined ? peticion : peticion.set('Authorization', `Bearer ${token}`)
      ).send({});
    };
    for (const [metodo, ruta] of [
      ['get', '/puente/configuracion'],
      ['get', '/puente/trabajos'],
      ['post', `/puente/trabajos/${randomUUID()}/resultado`],
      ['post', '/puente/latido'],
    ] as const) {
      const conPuente = await llamar(metodo, ruta, tokenPuente());
      expect(conPuente.status, `${metodo} ${ruta}`).toBe(500);
      const sin = await llamar(metodo, ruta);
      expect(sin.status, `${metodo} ${ruta} sin credencial`).toBe(401);
      expect(sin.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
      const otro = await llamar(metodo, ruta, tokenVinculacion());
      expect(otro.status, `${metodo} ${ruta} con un vi.`).toBe(401);
    }
  });

  it('iniciar con un token pu. recibe "No implementado" al pedir la configuración', async () => {
    const simulador = new SimuladorPuente({ api: url, token: tokenPuente() });
    await expect(simulador.iniciar()).rejects.toMatchObject({
      estado: 500,
      codigo: 'ERROR_INTERNO',
    });
  });

  it('el espacio /puente de Socket.IO rechaza toda conexión con "No implementado"', async () => {
    const resultado = await ClienteTiempoReal.intentarConectar(
      app,
      { token: tokenPuente() },
      { espacio: '/puente' },
    );
    expect(resultado).toEqual({ cliente: null, error: 'No implementado' });
    // Y el de la PWA sigue exigiendo una sesión de persona.
    const pwa = await ClienteTiempoReal.intentarConectar(app, { token: tokenPuente() });
    expect(pwa).toEqual({ cliente: null, error: 'NO_AUTENTICADO' });
  });
});
