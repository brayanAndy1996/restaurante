// Pruebas del desarrollador (no protegidas) de T12 a T16 que las protegidas de `test/acceso/` no alcanzan:
// el nombre de quien da soporte en `GET /sesion`, el último Administrador con cambios concurrentes, el
// cierre de sesiones al quitar un acceso y la salida del soporte. Usan la API real con `RelojManual`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { abrirCliente } from '../utilidades';
import {
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuarioConSesion,
  exigirEstado,
  ingresarOk,
  nuevoSuperadmin,
  type AppDePrueba,
} from '../acceso/fabrica-plataforma';

const INICIO = '2030-05-06T10:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

describe('soporte', () => {
  it('GET /sesion de una sesión de soporte trae quién da el soporte, con su nombre', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const empresa = await altaEmpresa(ctx, sa, { conSesion: false });
    const soporte = await ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: 'Revisar la sesión' });
    exigirEstado(soporte, 201, 'soporte');
    const res = await ctx.http().get('/sesion').set(bearer(soporte.body.token));
    exigirEstado(res, 200, 'GET /sesion');
    expect(res.body.superadministrador).toEqual({ id: sa.id, nombre: sa.nombre });
    expect(res.body.superadministrador).toEqual(soporte.body.sesion.superadministrador);
  });
});

describe('usuarios', () => {
  it('dos cambios concurrentes que quitan a los dos únicos Administradores: uno se aplica y el otro responde 409', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const empresa = await altaEmpresa(ctx, sa);
    const otro = await crearUsuarioConSesion(ctx, empresa.admin.token, { esAdministrador: true });
    const sucursalId = empresa.sucursales[0]!.id;
    const bajar = (token: string, id: string) =>
      ctx
        .http()
        .patch(`/usuarios/${id}`)
        .set(bearer(token))
        .send({ esAdministrador: false, accesos: [{ sucursalId, rol: 'MOZO' }] });
    const [uno, dos] = await Promise.all([
      bajar(empresa.admin.token, otro.id),
      bajar(otro.token, empresa.admin.id),
    ]);
    const estados = [uno.status, dos.status].sort();
    expect(estados, JSON.stringify([uno.body, dos.body])).toEqual([200, 409]);
    const { rows } = await admin.query(
      'SELECT count(*)::int AS n FROM usuario WHERE empresa_id = $1 AND es_administrador AND activo',
      [empresa.empresaId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('desactivar a un usuario cierra todas sus sesiones y no puede volver a entrar', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const empresa = await altaEmpresa(ctx, sa);
    const u = await crearUsuarioConSesion(ctx, empresa.admin.token, {
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'CAJERO' }],
    });
    const otraSesion = await ingresarOk(ctx, u.usuario, u.contrasena);
    const baja = await ctx
      .http()
      .patch(`/usuarios/${u.id}`)
      .set(bearer(empresa.admin.token))
      .send({ activo: false });
    exigirEstado(baja, 200, 'desactivar');
    for (const token of [u.token, otraSesion.token]) {
      expect((await ctx.http().get('/sesion').set(bearer(token))).status).toBe(401);
    }
    const ingreso = await ctx
      .http()
      .post('/sesiones/contrasena')
      .send({ usuario: u.usuario, contrasena: u.contrasena });
    expect(ingreso.status).toBe(401);
    expect(ingreso.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
  });

  it('cambiar la contraseña propia deja la cuenta sin la marca de temporal y la nueva sirve para ingresar', async () => {
    const sa = await nuevoSuperadmin(ctx);
    const empresa = await altaEmpresa(ctx, sa);
    const nueva = contrasenaUnica();
    const res = await ctx
      .http()
      .put('/sesion/contrasena')
      .set(bearer(empresa.admin.token))
      .send({ actual: empresa.admin.contrasena, nueva });
    exigirEstado(res, 204, 'cambio');
    const ingreso = await ingresarOk(ctx, empresa.admin.usuario, nueva);
    expect(ingreso.sesion).toMatchObject({ debeCambiarContrasena: false });
  });
});
