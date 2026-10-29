import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { crearUsuario, escenarioPerezoso, ingresar, sesionAdmin } from '../acceso/fabrica-sesiones';

// Historia 004, T35 (3b): cómo el guard global de autenticación trata las rutas `/puente/*`. Con una credencial
// `pu.…` (o `vi.…` en la vinculación) pasan a su guard; con cualquier otra se tratan como el resto de la API y el
// guard del puente responde 401 `NO_AUTENTICADO`, de modo que una sesión de persona nunca entra por ahí (criterio
// 109). No es una prueba protegida.

const sc = escenarioPerezoso({ poolMax: 2 });
afterAll(async () => {
  await sc.cerrar();
});

const RUTAS_DEL_PUENTE = [
  ['get', '/puente/configuracion'],
  ['get', '/puente/trabajos'],
  ['post', `/puente/trabajos/${randomUUID()}/resultado`],
  ['post', '/puente/latido'],
  ['post', '/puente/vinculacion'],
] as const;

const secreto = () => randomBytes(32).toString('base64url');

describe('rutas /puente/* y los tokens de persona', () => {
  it('una sesión de persona válida recibe 401 NO_AUTENTICADO en cada ruta del puente, sin ejecutarla', async () => {
    const esc = await sc.obtener();
    const { token } = await sesionAdmin(esc, esc.A);
    for (const [metodo, ruta] of RUTAS_DEL_PUENTE) {
      const res = await esc.api.llamar(metodo, ruta, {
        token,
        cuerpo: metodo === 'get' ? undefined : {},
      });
      expect(res.status, `${metodo} ${ruta}: ${res.text}`).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
  });

  it('sin Authorization cada ruta del puente responde 401 NO_AUTENTICADO, también con la empresa en la cabecera del modo de prueba', async () => {
    const esc = await sc.obtener();
    for (const cabeceras of [{}, { 'x-empresa-id': esc.A.id }] as Record<string, string>[]) {
      for (const [metodo, ruta] of RUTAS_DEL_PUENTE) {
        const res = await esc.api.llamar(metodo, ruta, {
          cabeceras,
          cuerpo: metodo === 'get' ? undefined : {},
        });
        expect(res.status, `${metodo} ${ruta}: ${res.text}`).toBe(401);
        expect(res.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
      }
    }
  });

  it('una sesión con contraseña temporal recibe 403 CAMBIO_CONTRASENA_REQUERIDO, como en el resto de la API', async () => {
    const esc = await sc.obtener();
    const u = await crearUsuario(esc, esc.A, { esAdministrador: true, activar: false });
    const ingreso = await ingresar(esc.api, u.nombreUsuario, u.contrasena);
    expect(ingreso.status, ingreso.text).toBe(201);
    for (const [metodo, ruta] of RUTAS_DEL_PUENTE) {
      const res = await esc.api.llamar(metodo, ruta, {
        token: ingreso.body.token,
        cuerpo: metodo === 'get' ? undefined : {},
      });
      expect(res.status, `${metodo} ${ruta}`).toBe(403);
      expect(res.body).toMatchObject({ codigo: 'CAMBIO_CONTRASENA_REQUERIDO' });
    }
  });

  it('un token pu. en una ruta de persona y un vi. en una ruta del puente que no es la vinculación son 401', async () => {
    const esc = await sc.obtener();
    const pu = `pu.${esc.A.id}.${randomUUID()}.${secreto()}`;
    const vi = `vi.${esc.A.id}.${randomUUID()}.${secreto()}`;
    for (const ruta of [
      '/sesion',
      '/usuarios',
      '/sucursales',
      '/salon',
      '/ordenes/' + randomUUID(),
    ]) {
      const res = await esc.api.get(ruta, { token: pu });
      expect(res.status, `GET ${ruta} con pu.`).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
    for (const [metodo, ruta] of RUTAS_DEL_PUENTE.filter(([, r]) => r !== '/puente/vinculacion')) {
      const res = await esc.api.llamar(metodo, ruta, {
        token: vi,
        cuerpo: metodo === 'get' ? undefined : {},
      });
      expect(res.status, `${metodo} ${ruta} con vi.`).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    }
    const conPu = await esc.api.post('/puente/vinculacion', { token: pu, cuerpo: {} });
    expect(conPu.status).toBe(401);
    expect(conPu.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
  });
});
