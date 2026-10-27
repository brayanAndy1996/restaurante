// Criterio 40b (pruebas del desarrollador, complementan las protegidas de aislamiento/): límite del
// cuerpo en cualquier ruta, NUL en `actor` y `motivo`, y el registro de errores.
import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { PlataformaEmpresasService } from '../src/modulos/plataforma';
import { fijarEntornoDePrueba } from './utilidades';
import { datosDeEmpresa, textoUnico } from './aislamiento/fabrica';

let app: INestApplication;

beforeAll(async () => {
  fijarEntornoDePrueba();
  app = await crearAplicacion();
});

afterAll(async () => {
  await app?.close();
});

const LIMITE = 100 * 1024;
const http = () => request(app.getHttpServer());

describe('criterio 40b · cuerpo mayor a 100 KB', () => {
  it('responde 413 CUERPO_DEMASIADO_GRANDE en cualquier ruta, método y sin registrar un error interno', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const grande = JSON.stringify({ x: 'x'.repeat(LIMITE) });
      for (const [metodo, ruta] of [
        ['post', '/health'],
        ['get', '/health'],
        ['put', '/no-existe'],
        ['delete', '/sucursales'],
      ] as const) {
        const res = await http()[metodo](ruta).set('content-type', 'application/json').send(grande);
        expect(res.status, `${metodo} ${ruta}`).toBe(413);
        expect(res.body).toEqual({
          codigo: 'CUERPO_DEMASIADO_GRANDE',
          mensaje: expect.any(String),
        });
      }
      const formulario = await http()
        .post('/health')
        .type('form')
        .send(`x=${'x'.repeat(LIMITE)}`);
      expect(formulario.status).toBe(413);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('un cuerpo justo por debajo del límite llega a la ruta (no es 413)', async () => {
    const res = await http()
      .post('/health')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ x: 'x'.repeat(LIMITE - 100) }));
    expect(res.status).not.toBe(413);
  });
});

describe('criterio 40b · NUL en actor y motivo de una operación de plataforma', () => {
  const NUL = '\u0000';

  it.each([
    ['actor', { actor: `ana${NUL}`, motivo: 'Alta' }],
    ['motivo', { actor: textoUnico('actor'), motivo: `Alta${NUL}` }],
  ] as const)(
    'registrarEmpresa con NUL en %s falla indicando el campo y no crea nada',
    async (campo, auditoria) => {
      const datos = datosDeEmpresa();
      const servicio = app.get(PlataformaEmpresasService);
      const error = await servicio.registrarEmpresa(datos, auditoria).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.())).toContain(
        campo,
      );
      // Nada creado: el mismo RUC se puede registrar con una auditoría válida.
      const ok = await servicio.registrarEmpresa(datos, {
        actor: textoUnico('actor'),
        motivo: 'Alta tras el rechazo',
      });
      expect(ok.empresaId).toBeTruthy();
    },
  );
});
