import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { ContextoEmpresa } from '../src/nucleo/contexto-empresa';
import { EntornoInvalidoError } from '../src/config/entorno';
import { fijarEntornoDePrueba } from './utilidades';

// Pruebas de humo de la fábrica de la aplicación (no son las pruebas protegidas de aislamiento).

@Controller('sonda-humo')
class SondaHumoController {
  constructor(readonly contexto: ContextoEmpresa) {}

  @Get()
  ver() {
    return { inyectado: this.contexto instanceof ContextoEmpresa };
  }
}

describe('crearAplicacion', () => {
  const abiertas: INestApplication[] = [];
  afterEach(async () => {
    while (abiertas.length) await abiertas.pop()?.close();
  });

  async function crear(...args: Parameters<typeof crearAplicacion>) {
    const app = await crearAplicacion({ logger: false, ...args[0] });
    abiertas.push(app);
    return app;
  }

  it('rechaza EMPRESA_POR_HEADER=habilitado con NODE_ENV=production', async () => {
    fijarEntornoDePrueba({ nodeEnv: 'production' });
    await expect(crear()).rejects.toThrow(EntornoInvalidoError);
    await expect(crear()).rejects.toThrow(/prohibido en producción/);
  });

  it('acepta producción sin EMPRESA_POR_HEADER y test con la cabecera, en el mismo proceso', async () => {
    fijarEntornoDePrueba({ nodeEnv: 'production', empresaPorHeader: false });
    await crear();
    fijarEntornoDePrueba();
    await crear();
  });

  it('no escucha ningún puerto y responde 404 JSON en rutas desconocidas', async () => {
    fijarEntornoDePrueba();
    const app = await crear();
    const res = await request(app.getHttpServer()).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('las rutas existen: sin sesión las de empresa responden 401 NO_AUTENTICADO y /health responde', async () => {
    fijarEntornoDePrueba({ empresaPorHeader: false });
    const app = await crear();
    for (const [metodo, ruta] of [
      ['get', '/sucursales'],
      ['get', '/sucursales/11111111-1111-1111-1111-111111111111'],
      ['patch', '/sucursales/11111111-1111-1111-1111-111111111111'],
    ] as const) {
      const res = await request(app.getHttpServer())[metodo](ruta);
      expect(res.status, `${metodo} ${ruta}`).toBe(401);
      // Desde la historia 002 las rutas están protegidas por defecto: sin sesión (y sin la cabecera de
      // prueba habilitada) el código es NO_AUTENTICADO, no EMPRESA_NO_RESUELTA.
      expect(res.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
    const salud = await request(app.getHttpServer()).get('/health');
    expect(salud.status).toBe(200);
  });

  it('permite registrar controladores extra que inyectan ContextoEmpresa', async () => {
    fijarEntornoDePrueba();
    const app = await crear({ controladoresExtra: [SondaHumoController] });
    expect(app.get(ContextoEmpresa)).toBeInstanceOf(ContextoEmpresa);
    // Sin cabecera de empresa, el interceptor global responde 401 antes de llegar al controlador.
    const res = await request(app.getHttpServer()).get('/sonda-humo');
    expect(res.status).toBe(401);
  });
});
