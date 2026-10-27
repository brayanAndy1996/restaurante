// Pruebas del desarrollador (no protegidas) de T10: el guard global de autenticación, el principal de la
// petición, el resolutor por sesión (empresa y actor), las reglas de ruta (@SoloAdministrador,
// @RequiereSucursal, contraseña temporal) y el modo de prueba con la cabecera solo con NODE_ENV=test. Las
// sesiones y los usuarios se siembran por SQL: el ingreso y el alta llegan en las tareas T12 y T13.
import { Controller, Get, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import {
  PermiteContrasenaTemporal,
  RequiereSucursal,
  SesionActual,
  SoloAdministrador,
} from '../../src/modulos/seguridad';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { RelojManual } from '../../src/nucleo/reloj';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { conActor, crearEmpresaSql, enTransaccion, type EmpresaSql } from '../aislamiento/fabrica';
import { arrancar, bearer, type AppDePrueba } from '../acceso/fabrica-plataforma';
import {
  credenciales,
  insertarEquipo,
  insertarSesion,
  insertarSuperadministrador,
  insertarUsuario,
} from './sembrado';

const MINUTO = 60_000;
const INICIO = '2031-03-10T10:00:00-05:00';

@Controller('sonda-guard')
class SondaGuardController {
  constructor(
    private readonly sesion: SesionActual,
    private readonly contexto: ContextoEmpresa,
  ) {}

  @Get('principal')
  principal() {
    return {
      principal: this.sesion.principal(),
      empresaDelContexto: this.contexto.empresaActual(),
    };
  }

  @Get('solo-admin')
  @SoloAdministrador()
  soloAdmin() {
    return { ok: true };
  }

  @Get('con-sucursal')
  @RequiereSucursal()
  conSucursal() {
    return { ok: true };
  }

  @Get('temporal')
  @PermiteContrasenaTemporal()
  temporal() {
    return { ok: true };
  }

  @Post('escribir')
  escribir() {
    return { ok: true };
  }
}

let ctx: AppDePrueba;
let api: Client;
let plataforma: Client;
let admin: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO, controladoresExtra: [SondaGuardController] });
  api = await abrirCliente('api');
  plataforma = await abrirCliente('plataforma');
  admin = await abrirCliente('admin');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await ctx?.cerrar();
  for (const c of [api, plataforma, admin]) await c?.end();
});

const ahora = () => ctx.reloj.ahora();

/** Una sesión de contraseña de un usuario nuevo de `empresa`. */
async function sesionDe(
  empresa: EmpresaSql,
  usuario: Parameters<typeof insertarUsuario>[2] = {},
  sesion: Partial<Parameters<typeof insertarSesion>[2]> = {},
) {
  const u = await insertarUsuario(api, empresa.id, usuario);
  const s = await insertarSesion(api, empresa.id, { usuarioId: u.id, ahora: ahora(), ...sesion });
  return { usuario: u, ...s };
}

const filaDeSesion = async (id: string) =>
  (await admin.query('SELECT * FROM sesion WHERE id = $1', [id])).rows[0];

const NO_AUTENTICADO = { codigo: 'NO_AUTENTICADO' };

describe('sin sesión válida', () => {
  it('sin Authorization, con token mal formado, sa. o eq. responde 401 NO_AUTENTICADO sin abrir contexto', async () => {
    const espia = vi.spyOn(ctx.app.get(ContextoEmpresa), 'ejecutar');
    try {
      const secreto = credenciales.generarSecreto();
      for (const cabeceras of [
        {},
        { Authorization: 'Bearer ' },
        { Authorization: 'Basic abc' },
        { Authorization: 'Bearer basura' },
        { Authorization: `Bearer sa.${randomUUID()}.${secreto}` },
        { Authorization: `Bearer eq.${A.id}.${randomUUID()}.${secreto}` },
        { 'X-Equipo': `eq.${A.id}.${randomUUID()}.${secreto}` },
      ]) {
        const res = await ctx.http().get('/sonda-guard/principal').set(cabeceras);
        expect(res.status, JSON.stringify(cabeceras)).toBe(401);
        expect(res.body, JSON.stringify(cabeceras)).toMatchObject(NO_AUTENTICADO);
      }
      expect(espia).not.toHaveBeenCalled();
    } finally {
      espia.mockRestore();
    }
  });

  it('una sesión inexistente y un secreto equivocado dan el mismo 401, y el secreto equivocado no toca la sesión', async () => {
    const { id, token } = await sesionDe(A);
    ctx.reloj.avanzar(5 * MINUTO);
    const antes = await filaDeSesion(id);
    const malSecreto = token.replace(/\.[^.]+$/, `.${credenciales.generarSecreto()}`);
    const inexistente = `se.${A.id}.${randomUUID()}.${credenciales.generarSecreto()}`;
    const respuestas = [];
    for (const t of [malSecreto, inexistente]) {
      respuestas.push(await ctx.http().get('/sonda-guard/principal').set(bearer(t)));
    }
    for (const res of respuestas) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject(NO_AUTENTICADO);
    }
    expect(respuestas[1]!.body).toEqual(respuestas[0]!.body);
    expect(await filaDeSesion(id)).toEqual(antes);
  });

  it('el token de A con la empresa cambiada por B (o la sesión de B con el secreto de A) responde 401 y no toca la sesión de B', async () => {
    const deA = await sesionDe(A);
    const deB = await sesionDe(B);
    ctx.reloj.avanzar(2 * MINUTO);
    const antesB = await filaDeSesion(deB.id);
    const intentos = [
      deA.token.replace(`se.${A.id}.`, `se.${B.id}.`),
      `se.${A.id}.${deB.id}.${deA.secreto}`,
      `se.${B.id}.${deB.id}.${deA.secreto}`,
    ];
    for (const token of intentos) {
      const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
      expect(res.status, token).toBe(401);
      expect(res.body).toMatchObject(NO_AUTENTICADO);
    }
    expect(await filaDeSesion(deB.id)).toEqual(antesB);
  });

  it('una sesión PIN sin la cabecera X-Equipo, con la de otro equipo o con un secreto falso no vale', async () => {
    const u = await insertarUsuario(api, A.id, {});
    const equipo = await insertarEquipo(api, A.id, u.id);
    const otro = await insertarEquipo(api, A.id, u.id);
    const pin = await insertarSesion(api, A.id, {
      usuarioId: u.id,
      tipo: 'PIN',
      equipoId: equipo.equipoId,
      equipoRecordadoId: equipo.equipoRecordadoId,
      ahora: ahora(),
    });
    const secretoFalso = credenciales.generarSecreto();
    const falso = equipo.tokenEquipo.replace(/[^.]+$/, secretoFalso);
    for (const cabecera of [undefined, otro.tokenEquipo, falso, 'basura']) {
      const peticion = ctx.http().get('/sonda-guard/principal').set(bearer(pin.token));
      const res = await (cabecera === undefined ? peticion : peticion.set('X-Equipo', cabecera));
      expect(res.status, String(cabecera)).toBe(401);
      expect(res.body).toMatchObject(NO_AUTENTICADO);
    }
    // La sesión no se tocó: con el equipo correcto sigue valiendo.
    const bien = await ctx
      .http()
      .get('/sonda-guard/principal')
      .set(bearer(pin.token))
      .set('X-Equipo', equipo.tokenEquipo);
    expect(bien.status, JSON.stringify(bien.body)).toBe(200);
    expect(bien.body.principal).toMatchObject({
      tipo: 'PIN',
      usuarioId: u.id,
      equipoId: equipo.equipoId,
      equipoRecordadoId: equipo.equipoRecordadoId,
    });
  });

  it('una sesión PIN cuyo equipo recordado fue revocado se cierra y responde 401', async () => {
    const u = await insertarUsuario(api, A.id, {});
    const equipo = await insertarEquipo(api, A.id, u.id);
    const pin = await insertarSesion(api, A.id, {
      usuarioId: u.id,
      tipo: 'PIN',
      equipoId: equipo.equipoId,
      equipoRecordadoId: equipo.equipoRecordadoId,
      ahora: ahora(),
    });
    await enTransaccion(
      api,
      A.id,
      async () => {
        await api.query(
          `UPDATE equipo_recordado SET revocado_en = now(), motivo_revocacion = 'REVOCADO' WHERE id = $1`,
          [equipo.equipoRecordadoId],
        );
      },
      { confirmar: true },
    );
    const res = await ctx
      .http()
      .get('/sonda-guard/principal')
      .set(bearer(pin.token))
      .set('X-Equipo', equipo.tokenEquipo);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject(NO_AUTENTICADO);
    expect((await filaDeSesion(pin.id)).motivo_cierre).toBe('EQUIPO_REVOCADO');
  });
});

describe('sesión de contraseña válida', () => {
  it('deja el principal con la empresa, el usuario, la sucursal y el rol, y corre dentro del contexto de esa empresa', async () => {
    const sucursal = A.sucursales[0]!.id;
    const { usuario, token, id } = await sesionDe(
      A,
      { accesos: [{ sucursalId: sucursal, rol: 'CAJERO' }] },
      { sucursalId: sucursal },
    );
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.empresaDelContexto).toBe(A.id);
    expect(res.body.principal).toEqual({
      tipo: 'CONTRASENA',
      empresaId: A.id,
      sesionId: id,
      usuarioId: usuario.id,
      superadministradorId: null,
      sucursalId: sucursal,
      rol: 'CAJERO',
      esAdministrador: false,
      equipoId: null,
      equipoRecordadoId: null,
      debeCambiarContrasena: false,
    });
  });

  it('la empresa sale de la sesión: x-empresa-id, parámetros y cuerpo no la cambian', async () => {
    const { token } = await sesionDe(A, { esAdministrador: true });
    const res = await ctx
      .http()
      .get(`/sucursales?empresaId=${B.id}`)
      .set(bearer(token))
      .set('x-empresa-id', B.id);
    expect(res.status).toBe(200);
    expect(res.body.map((s: { id: string }) => s.id).sort()).toEqual(
      A.sucursales.map((s) => s.id).sort(),
    );
  });

  it('el Administrador tiene rol ADMINISTRADOR con o sin sucursal activa y sin filas de acceso', async () => {
    const sucursal = A.sucursales[1]!.id;
    for (const sucursalId of [null, sucursal]) {
      const { token } = await sesionDe(A, { esAdministrador: true }, { sucursalId });
      const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
      expect(res.body.principal).toMatchObject({
        rol: 'ADMINISTRADOR',
        esAdministrador: true,
        sucursalId,
      });
    }
  });

  it('un usuario sin sucursal activa tiene rol null', async () => {
    const { token } = await sesionDe(A, {
      accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
    });
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.body.principal).toMatchObject({ rol: null, sucursalId: null });
  });

  it('el equipo recordado de la sesión viaja en el principal', async () => {
    const u = await insertarUsuario(api, A.id, {});
    const { equipoId, equipoRecordadoId } = await insertarEquipo(api, A.id, u.id);
    const { token } = await insertarSesion(api, A.id, {
      usuarioId: u.id,
      ahora: ahora(),
      equipoId,
      equipoRecordadoId,
    });
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.body.principal).toMatchObject({ equipoId, equipoRecordadoId });
  });

  it('una sesión de contraseña asociada a un equipo recordado revocado se cierra', async () => {
    const u = await insertarUsuario(api, A.id, {});
    const equipo = await insertarEquipo(api, A.id, u.id);
    const { token, id } = await insertarSesion(api, A.id, {
      usuarioId: u.id,
      ahora: ahora(),
      equipoId: equipo.equipoId,
      equipoRecordadoId: equipo.equipoRecordadoId,
    });
    await enTransaccion(
      api,
      A.id,
      async () => {
        await api.query(
          `UPDATE equipo_recordado SET revocado_en = now(), motivo_revocacion = 'OLVIDADO' WHERE id = $1`,
          [equipo.equipoRecordadoId],
        );
      },
      { confirmar: true },
    );
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.status).toBe(401);
    expect((await filaDeSesion(id)).motivo_cierre).toBe('EQUIPO_REVOCADO');
  });
});

describe('actividad, inactividad y duración', () => {
  it('toda petición renueva la actividad con el reloj de la API, salvo X-Actividad: segundo-plano', async () => {
    const { token, id } = await sesionDe(A);
    const inicial = (await filaDeSesion(id)).ultima_actividad_en as Date;
    ctx.reloj.avanzar(10 * MINUTO);
    await ctx
      .http()
      .get('/sonda-guard/principal')
      .set(bearer(token))
      .set('X-Actividad', 'segundo-plano');
    expect(((await filaDeSesion(id)).ultima_actividad_en as Date).getTime()).toBe(
      inicial.getTime(),
    );
    await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(((await filaDeSesion(id)).ultima_actividad_en as Date).getTime()).toBe(
      ahora().getTime(),
    );
  });

  it('la renovación queda guardada aunque el controlador falle', async () => {
    const { token, id } = await sesionDe(A);
    ctx.reloj.avanzar(7 * MINUTO);
    const res = await ctx.http().get(`/sucursales/${randomUUID()}`).set(bearer(token));
    expect(res.status).toBe(404);
    expect(((await filaDeSesion(id)).ultima_actividad_en as Date).getTime()).toBe(
      ahora().getTime(),
    );
  });

  it('a los 30 minutos exactos sin peticiones la sesión expira (SESION_EXPIRADA) y queda cerrada; antes sigue valiendo', async () => {
    const { token, id } = await sesionDe(A);
    ctx.reloj.avanzar(30 * MINUTO - 1);
    expect((await ctx.http().get('/sonda-guard/principal').set(bearer(token))).status).toBe(200);
    ctx.reloj.avanzar(30 * MINUTO);
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ codigo: 'SESION_EXPIRADA' });
    const fila = await filaDeSesion(id);
    expect(fila.cerrada_en).not.toBeNull();
    expect(fila.motivo_cierre).toBe('EXPIRADA');
    // Una sesión ya cerrada responde NO_AUTENTICADO.
    const otra = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(otra.body).toMatchObject(NO_AUTENTICADO);
  });

  it('el máximo absoluto de la sesión se aplica aunque haya actividad reciente', async () => {
    const { token, id } = await sesionDe(A, {}, { minutosInactividad: 120, horasDeDuracion: 1 });
    ctx.reloj.avanzar(59 * MINUTO);
    expect((await ctx.http().get('/sonda-guard/principal').set(bearer(token))).status).toBe(200);
    ctx.reloj.avanzar(2 * MINUTO);
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ codigo: 'SESION_EXPIRADA' });
    expect((await filaDeSesion(id)).cerrada_en).not.toBeNull();
  });
});

describe('rol y acceso en cada petición (criterio 6)', () => {
  it('cuando cambia el rol en la sucursal activa, la siguiente petición usa el rol nuevo', async () => {
    const sucursal = A.sucursales[0]!.id;
    const { token, usuario } = await sesionDe(
      A,
      { accesos: [{ sucursalId: sucursal, rol: 'MOZO' }] },
      { sucursalId: sucursal },
    );
    const rolActual = async () =>
      (await ctx.http().get('/sonda-guard/principal').set(bearer(token))).body.principal.rol;
    expect(await rolActual()).toBe('MOZO');
    await conActor(
      admin,
      () =>
        admin.query('UPDATE acceso_sucursal SET rol = $2 WHERE usuario_id = $1', [
          usuario.id,
          'SUPERVISOR',
        ]),
      { confirmar: true },
    );
    expect(await rolActual()).toBe('SUPERVISOR');
  });

  it('si le quitan el acceso a la sucursal activa, la sesión se cierra y responde 401', async () => {
    const sucursal = A.sucursales[0]!.id;
    const { token, usuario, id } = await sesionDe(
      A,
      { accesos: [{ sucursalId: sucursal, rol: 'MOZO' }] },
      { sucursalId: sucursal },
    );
    await admin.query('DELETE FROM acceso_sucursal WHERE usuario_id = $1', [usuario.id]);
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject(NO_AUTENTICADO);
    expect((await filaDeSesion(id)).motivo_cierre).toBe('ACCESO_QUITADO');
  });

  it('quitar el acceso a otra sucursal no cierra la sesión', async () => {
    const [activa, otra] = [A.sucursales[0]!.id, A.sucursales[1]!.id];
    const { token, usuario } = await sesionDe(
      A,
      {
        accesos: [
          { sucursalId: activa, rol: 'MOZO' },
          { sucursalId: otra, rol: 'MOZO' },
        ],
      },
      { sucursalId: activa },
    );
    await admin.query('DELETE FROM acceso_sucursal WHERE usuario_id = $1 AND sucursal_id = $2', [
      usuario.id,
      otra,
    ]);
    expect((await ctx.http().get('/sonda-guard/principal').set(bearer(token))).status).toBe(200);
  });

  it('si desactivan al usuario, la sesión se cierra y responde 401', async () => {
    const { token, usuario, id } = await sesionDe(A, { esAdministrador: true });
    await conActor(
      admin,
      () => admin.query('UPDATE usuario SET activo = false WHERE id = $1', [usuario.id]),
      {
        confirmar: true,
      },
    );
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject(NO_AUTENTICADO);
    expect((await filaDeSesion(id)).motivo_cierre).toBe('USUARIO_INACTIVO');
  });
});

describe('reglas de la ruta', () => {
  it('@SoloAdministrador: el Administrador pasa y los demás reciben 403 PROHIBIDO', async () => {
    const sucursal = A.sucursales[0]!.id;
    const admin1 = await sesionDe(A, { esAdministrador: true });
    expect((await ctx.http().get('/sonda-guard/solo-admin').set(bearer(admin1.token))).status).toBe(
      200,
    );
    for (const rol of ['MOZO', 'CAJERO', 'COCINA_BARRA', 'SUPERVISOR'] as const) {
      const otro = await sesionDe(
        A,
        { accesos: [{ sucursalId: sucursal, rol }] },
        { sucursalId: sucursal },
      );
      const res = await ctx.http().get('/sonda-guard/solo-admin').set(bearer(otro.token));
      expect(res.status, rol).toBe(403);
      expect(res.body, rol).toMatchObject({ codigo: 'PROHIBIDO' });
    }
    // Sin sucursal activa tampoco.
    const sinSucursal = await sesionDe(A, {
      accesos: [{ sucursalId: sucursal, rol: 'SUPERVISOR' }],
    });
    expect(
      (await ctx.http().get('/sonda-guard/solo-admin').set(bearer(sinSucursal.token))).status,
    ).toBe(403);
  });

  it('@RequiereSucursal: sin sucursal activa responde 409 SUCURSAL_NO_ELEGIDA y con ella pasa', async () => {
    const sucursal = A.sucursales[0]!.id;
    const sin = await sesionDe(A, { esAdministrador: true });
    const res = await ctx.http().get('/sonda-guard/con-sucursal').set(bearer(sin.token));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'SUCURSAL_NO_ELEGIDA' });
    const con = await sesionDe(A, { esAdministrador: true }, { sucursalId: sucursal });
    expect((await ctx.http().get('/sonda-guard/con-sucursal').set(bearer(con.token))).status).toBe(
      200,
    );
  });

  it('contraseña temporal: toda ruta responde 403 CAMBIO_CONTRASENA_REQUERIDO salvo las que la permiten', async () => {
    const { token } = await sesionDe(A, { esAdministrador: true, contrasenaTemporal: true });
    const principal = await ctx.http().get('/sonda-guard/principal').set(bearer(token));
    expect(principal.status).toBe(403);
    expect(principal.body).toMatchObject({ codigo: 'CAMBIO_CONTRASENA_REQUERIDO' });
    for (const ruta of ['/sucursales', '/usuarios', '/sonda-guard/solo-admin']) {
      const res = await ctx.http().get(ruta).set(bearer(token));
      expect(res.status, ruta).toBe(403);
      expect(res.body, ruta).toMatchObject({ codigo: 'CAMBIO_CONTRASENA_REQUERIDO' });
    }
    const permitida = await ctx.http().get('/sonda-guard/temporal').set(bearer(token));
    expect(permitida.status).toBe(200);
    // GET /sesion, PUT /sesion/contrasena y DELETE /sesion pasan el guard (su lógica llega con T12).
    for (const [metodo, ruta] of [
      ['get', '/sesion'],
      ['put', '/sesion/contrasena'],
      ['delete', '/sesion'],
    ] as const) {
      const res = await ctx.http()[metodo](ruta).set(bearer(token)).send({});
      expect(res.body.codigo, `${metodo} ${ruta}`).not.toBe('CAMBIO_CONTRASENA_REQUERIDO');
    }
  });
});

describe('sesión de soporte y trazabilidad por la vía de la sesión (criterio 117)', () => {
  it('la sesión de soporte es Administrador de la empresa, sin usuario, con el superadministrador de actor', async () => {
    const superadmin = await insertarSuperadministrador(plataforma);
    const soporte = await insertarSesion(api, A.id, {
      superadministradorId: superadmin,
      ahora: ahora(),
    });
    const res = await ctx.http().get('/sonda-guard/principal').set(bearer(soporte.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.principal).toMatchObject({
      tipo: 'SOPORTE',
      empresaId: A.id,
      usuarioId: null,
      superadministradorId: superadmin,
      rol: 'ADMINISTRADOR',
      esAdministrador: true,
    });
    const sucursalId = A.sucursales[0]!.id;
    const edicion = await ctx
      .http()
      .patch(`/sucursales/${sucursalId}`)
      .set(bearer(soporte.token))
      .send({ direccion: 'Editada en soporte 123' });
    expect(edicion.status, JSON.stringify(edicion.body)).toBe(200);
    const fila = (await admin.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId])).rows[0];
    expect(fila).toMatchObject({
      actualizado_por_superadministrador_id: superadmin,
      actualizado_por_usuario_id: null,
      actualizado_por_sistema: null,
    });
  });

  it('una escritura con sesión de usuario queda a nombre del usuario (y de su equipo) en la base', async () => {
    const usuario = await insertarUsuario(api, A.id, { esAdministrador: true });
    const { equipoId, equipoRecordadoId } = await insertarEquipo(api, A.id, usuario.id);
    const { token } = await insertarSesion(api, A.id, {
      usuarioId: usuario.id,
      ahora: ahora(),
      equipoId,
      equipoRecordadoId,
    });
    const sucursalId = A.sucursales[1]!.id;
    const antes = (await admin.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId])).rows[0];
    const res = await ctx
      .http()
      .patch(`/sucursales/${sucursalId}`)
      .set(bearer(token))
      .send({ direccion: `Editada por el usuario ${randomUUID().slice(0, 6)}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fila = (await admin.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId])).rows[0];
    expect(fila).toMatchObject({
      actualizado_por_usuario_id: usuario.id,
      actualizado_por_equipo_id: equipoId,
      actualizado_por_superadministrador_id: null,
      actualizado_por_sistema: null,
      creado_por_sistema: antes.creado_por_sistema,
    });
  });

  it('un usuario de otra empresa nunca queda como actor de una escritura (la sesión de A solo ve y cambia A)', async () => {
    const deB = await sesionDe(B, { esAdministrador: true });
    const sucursalDeA = A.sucursales[0]!.id;
    const res = await ctx
      .http()
      .patch(`/sucursales/${sucursalDeA}`)
      .set(bearer(deB.token))
      .send({ direccion: 'Intento desde B 123' });
    expect(res.status).toBe(404);
  });
});

describe('concurrencia (criterio 5)', () => {
  it('100 peticiones alternando sesiones de A y de B con un pool de 2 devuelven solo datos de su empresa', async () => {
    const deA = await sesionDe(A, { esAdministrador: true });
    const deB = await sesionDe(B, { esAdministrador: true });
    const idsA = A.sucursales.map((s) => s.id).sort();
    const idsB = B.sucursales.map((s) => s.id).sort();
    const respuestas = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        ctx
          .http()
          .get('/sucursales')
          .set(bearer(i % 2 === 0 ? deA.token : deB.token))
          .then((res) => ({ res, esperado: i % 2 === 0 ? idsA : idsB })),
      ),
    );
    for (const { res, esperado } of respuestas) {
      expect(res.status).toBe(200);
      expect(res.body.map((s: { id: string }) => s.id).sort()).toEqual(esperado);
    }
  });
});

describe('CORS', () => {
  it('responde el preflight solo a los orígenes permitidos y expone Retry-After', async () => {
    const permitido = await ctx
      .http()
      .options('/sucursales')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization,x-equipo,x-actividad,idempotency-key');
    expect(permitido.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(permitido.headers['access-control-allow-headers']?.toLowerCase()).toEqual(
      expect.stringContaining('x-equipo'),
    );
    expect(permitido.headers['access-control-allow-credentials']).toBeUndefined();
    const ajeno = await ctx
      .http()
      .options('/sucursales')
      .set('Origin', 'https://sitio-ajeno.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();
    const real = await ctx.http().get('/health').set('Origin', 'http://localhost:5173');
    expect(real.headers['access-control-expose-headers']).toMatch(/Retry-After/i);
    // La PWA mide el desfase del reloj del celular con la cabecera Date.
    expect(real.headers['access-control-expose-headers']).toMatch(/\bDate\b/);
  });
});

describe('modo de prueba (criterio 7)', () => {
  it('con NODE_ENV=test y la cabecera, sin Authorization corre como principal de prueba con actor `prueba`', async () => {
    fijarEntornoDePrueba({ empresaPorHeader: true, poolMax: 2 });
    const app = await crearAplicacion({
      reloj: new RelojManual(INICIO),
      logger: false,
      controladoresExtra: [SondaGuardController],
    });
    try {
      const http = () => request(app.getHttpServer());
      const principal = await http().get('/sonda-guard/principal').set('x-empresa-id', A.id);
      expect(principal.status, JSON.stringify(principal.body)).toBe(200);
      expect(principal.body.principal).toEqual({
        tipo: 'PRUEBA',
        empresaId: A.id,
        sesionId: null,
        usuarioId: null,
        superadministradorId: null,
        sucursalId: null,
        rol: 'ADMINISTRADOR',
        esAdministrador: true,
        equipoId: null,
        equipoRecordadoId: null,
        debeCambiarContrasena: false,
      });
      // Es Administrador, pero no tiene sucursal activa.
      expect((await http().get('/sonda-guard/solo-admin').set('x-empresa-id', A.id)).status).toBe(
        200,
      );
      expect((await http().get('/sonda-guard/con-sucursal').set('x-empresa-id', A.id)).status).toBe(
        409,
      );
      // La escritura queda con el actor de sistema `prueba`.
      const sucursalId = A.sucursales[0]!.id;
      const edicion = await http()
        .patch(`/sucursales/${sucursalId}`)
        .set('x-empresa-id', A.id)
        .send({ direccion: 'Editada en modo de prueba 1' });
      expect(edicion.status, JSON.stringify(edicion.body)).toBe(200);
      const fila = (await admin.query('SELECT * FROM sucursal WHERE id = $1', [sucursalId]))
        .rows[0];
      expect(fila.actualizado_por_sistema).toBe('prueba');
      expect(fila.actualizado_por_usuario_id).toBeNull();
      // Sin la cabecera o con una inválida: 401 EMPRESA_NO_RESUELTA.
      for (const cabeceras of [{}, { 'x-empresa-id': 'no-es-un-uuid' }]) {
        const res = await http().get('/sonda-guard/principal').set(cabeceras);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
      }
      // Con Authorization se ignora la cabecera: un token inválido no vuelve al modo de prueba.
      const conToken = await http()
        .get('/sonda-guard/principal')
        .set('x-empresa-id', A.id)
        .set(bearer(`se.${A.id}.${randomUUID()}.${credenciales.generarSecreto()}`));
      expect(conToken.status).toBe(401);
      expect(conToken.body).toMatchObject(NO_AUTENTICADO);
      // Las rutas públicas siguen sin principal.
      expect((await http().get('/health')).status).toBe(200);
    } finally {
      await app.close();
      fijarEntornoDePrueba({ empresaPorHeader: false });
    }
  });

  it('con development o production y la cabecera habilitada la API no arranca', async () => {
    for (const nodeEnv of ['development', 'production'] as const) {
      fijarEntornoDePrueba({ nodeEnv, empresaPorHeader: true });
      await expect(crearAplicacion({ logger: false }), nodeEnv).rejects.toThrow(
        /EMPRESA_POR_HEADER=habilitado/,
      );
    }
    fijarEntornoDePrueba({ empresaPorHeader: false });
  });

  it('sin la opción la cabecera se ignora siempre: 401 NO_AUTENTICADO', async () => {
    const res = await ctx.http().get('/sucursales').set('x-empresa-id', A.id);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject(NO_AUTENTICADO);
  });
});
