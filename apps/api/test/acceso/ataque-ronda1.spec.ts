// spec: 002-plataforma-y-acceso (pruebas protegidas)
//
// Ataque, ronda 1 (reportado por el adversarial). Cada prueba nace de una falla reproducida:
// - F1 · criterio 12 (y 16): las peticiones concurrentes con contraseña incorrecta no pueden saltarse el
//   bloqueo de 5 fallos de un usuario de empresa (`POST /sesiones/contrasena` y `PUT /sesion/contrasena`
//   cuentan para el mismo bloqueo): como máximo 5 respuestas 401 y el resto 429 `BLOQUEO_TEMPORAL`; la
//   contraseña correcta enviada después responde 429 y no crea sesión.
// - F2 · criterio 61: lo mismo para `POST /plataforma/sesiones` (superadministrador).
// - O1 · criterio 42 y contrato `ingresoRespuesta` (endpoint de soporte, criterio 66): la sesión que devuelve
//   `POST /plataforma/empresas/:id/soporte` es una `sesionRespuesta` y trae el mismo `rol` y los mismos
//   `permisos` que `GET /sesion` de esa sesión.
// - O2 · criterios 61, 62, 66 a 68: una sesión de soporte de un superadministrador desactivado (columna
//   `activo` de `superadministrador`, modelo de datos del spec) deja de valer aunque su fila de `sesion` siga
//   abierta (la desactivación ganó la carrera contra el INSERT de la sesión de soporte).
// La API real con `RelojManual` (el reloj no avanza: ningún bloqueo expira durante la prueba) y un pool de 10.
import { sesionRespuestaSchema, type SesionRespuesta } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancar,
  bearer,
  crearUsuarioConSesion,
  altaEmpresa,
  contrasenaUnica,
  exigirEstado,
  nuevoSuperadmin,
  partesDeToken,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
  type UsuarioDePrueba,
} from './fabrica-plataforma';

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;
let A: EmpresaDePrueba;

beforeAll(async () => {
  ctx = await arrancar({ poolMax: 10 });
  // Escucha en un puerto propio para que las peticiones realmente concurrentes no compartan servidor efímero.
  await ctx.app.listen(0);
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
  A = await altaEmpresa(ctx, sa);
}, 120_000);

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ------------------------------------------------------------------------------------------------
// Ayudantes
// ------------------------------------------------------------------------------------------------

interface Resp {
  status: number;
  body: Record<string, unknown> & { reintentarEnSegundos?: unknown };
  text: string;
}

const incorrecta = () => `Incorrecta-${randomUUID()}`;

/** Un Mozo de A con su contraseña ya cambiada (sesión abierta). */
function nuevoMozo(): Promise<UsuarioDePrueba> {
  return crearUsuarioConSesion(ctx, A.admin.token, {
    accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
  });
}

function ingresoFallido(usuario: string): Promise<Resp> {
  return ctx.http().post('/sesiones/contrasena').send({ usuario, contrasena: incorrecta() });
}

function cambioFallido(token: string): Promise<Resp> {
  return ctx
    .http()
    .put('/sesion/contrasena')
    .set(bearer(token))
    .send({ actual: incorrecta(), nueva: `Nueva-${randomUUID()}` });
}

function ingresoSuperadminFallido(usuario: string): Promise<Resp> {
  return ctx.http().post('/plataforma/sesiones').send({ usuario, contrasena: incorrecta() });
}

const cuenta = (respuestas: Resp[], status: number) =>
  respuestas.filter((r) => r.status === status).length;

/** Cada respuesta de la ráfaga es un 401 CREDENCIALES_INVALIDAS (como mucho 5) o un 429 BLOQUEO_TEMPORAL. */
function exigirBloqueoEnRafaga(respuestas: Resp[]): void {
  const resumen = respuestas.map((r) => r.status).join(',');
  const inesperadas = respuestas.filter((r) => r.status !== 401 && r.status !== 429);
  expect(inesperadas.map((r) => `${r.status} ${r.text}`)).toEqual([]);
  const rechazos = respuestas.filter((r) => r.status === 401);
  expect(
    rechazos.length,
    `solo 5 contraseñas pueden evaluarse antes del bloqueo; estados: ${resumen}`,
  ).toBeLessThanOrEqual(5);
  for (const r of rechazos) expect(r.body).toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS' });
  const bloqueadas = respuestas.filter((r) => r.status === 429);
  expect(bloqueadas.length).toBe(respuestas.length - rechazos.length);
  for (const r of bloqueadas) {
    expect(r.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    expect(typeof r.body.reintentarEnSegundos).toBe('number');
  }
}

const contarSesionesDeUsuario = async (usuarioId: string) =>
  Number(
    (await admin.query('SELECT count(*)::int AS n FROM sesion WHERE usuario_id = $1', [usuarioId]))
      .rows[0].n,
  );

const contarSesionesDeSuperadmin = async (superadministradorId: string) =>
  Number(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM sesion_superadministrador WHERE superadministrador_id = $1',
        [superadministradorId],
      )
    ).rows[0].n,
  );

// ------------------------------------------------------------------------------------------------
// F1 · criterio 12 (y 16) · usuario de empresa
// ------------------------------------------------------------------------------------------------
describe('F1 · criterio 12 · las peticiones concurrentes no saltan el bloqueo de contraseña', () => {
  it('30 ingresos simultáneos con contraseña incorrecta: como máximo 5 son 401 y el resto 429', async () => {
    const mozo = await nuevoMozo();
    const respuestas = await Promise.all(
      Array.from({ length: 30 }, () => ingresoFallido(mozo.usuario)),
    );
    exigirBloqueoEnRafaga(respuestas);
    expect(cuenta(respuestas, 429)).toBeGreaterThanOrEqual(25);
  });

  it('9 incorrectas en paralelo y, justo después, la correcta: responde 429 y no crea sesión', async () => {
    const mozo = await nuevoMozo();
    const antes = await contarSesionesDeUsuario(mozo.id);

    const rafaga = await Promise.all(Array.from({ length: 9 }, () => ingresoFallido(mozo.usuario)));
    exigirBloqueoEnRafaga(rafaga);

    const correcta = await ctx
      .http()
      .post('/sesiones/contrasena')
      .send({ usuario: mozo.usuario, contrasena: mozo.contrasena });
    expect(correcta.status, correcta.text).toBe(429);
    expect(correcta.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    expect(correcta.body.token).toBeUndefined();
    expect(await contarSesionesDeUsuario(mozo.id)).toBe(antes);
  });

  it('30 cambios de contraseña simultáneos con la actual incorrecta: como máximo 5 son 401 y el resto 429', async () => {
    const mozo = await nuevoMozo();
    const antes = await contarSesionesDeUsuario(mozo.id);

    const respuestas = await Promise.all(
      Array.from({ length: 30 }, () => cambioFallido(mozo.token)),
    );
    exigirBloqueoEnRafaga(respuestas);

    // La cuenta quedó bloqueada: ni el ingreso correcto ni el cambio con la actual correcta se evalúan.
    const correcta = await ctx
      .http()
      .post('/sesiones/contrasena')
      .send({ usuario: mozo.usuario, contrasena: mozo.contrasena });
    expect(correcta.status, correcta.text).toBe(429);
    expect(correcta.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    const cambio = await ctx
      .http()
      .put('/sesion/contrasena')
      .set(bearer(mozo.token))
      .send({ actual: mozo.contrasena, nueva: contrasenaUnica() });
    expect(cambio.status, cambio.text).toBe(429);
    expect(cambio.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    expect(await contarSesionesDeUsuario(mozo.id)).toBe(antes);
  });

  it('los ingresos y los cambios de contraseña fallidos, mezclados y simultáneos, cuentan para el mismo bloqueo', async () => {
    const mozo = await nuevoMozo();
    const respuestas = await Promise.all([
      ...Array.from({ length: 15 }, () => ingresoFallido(mozo.usuario)),
      ...Array.from({ length: 15 }, () => cambioFallido(mozo.token)),
    ]);
    exigirBloqueoEnRafaga(respuestas);
  });

  it('el bloqueo de un usuario por ráfaga no afecta a otro usuario de la misma empresa', async () => {
    const atacado = await nuevoMozo();
    const otro = await nuevoMozo();
    const rafaga = await Promise.all(
      Array.from({ length: 12 }, () => ingresoFallido(atacado.usuario)),
    );
    exigirBloqueoEnRafaga(rafaga);
    const res = await ctx
      .http()
      .post('/sesiones/contrasena')
      .send({ usuario: otro.usuario, contrasena: otro.contrasena });
    expect(res.status, res.text).toBe(201);
  });
});

// ------------------------------------------------------------------------------------------------
// F2 · criterio 61 · superadministrador
// ------------------------------------------------------------------------------------------------
describe('F2 · criterio 61 · las peticiones concurrentes no saltan el bloqueo del superadministrador', () => {
  it('50 ingresos simultáneos con contraseña incorrecta: como máximo 5 son 401 y el resto 429', async () => {
    const otro = await nuevoSuperadmin(ctx);
    const respuestas = await Promise.all(
      Array.from({ length: 50 }, () => ingresoSuperadminFallido(otro.usuario)),
    );
    exigirBloqueoEnRafaga(respuestas);
    expect(cuenta(respuestas, 429)).toBeGreaterThanOrEqual(45);
  });

  it('tras una ráfaga de incorrectas, la contraseña correcta responde 429 y no crea sesión', async () => {
    const otro = await nuevoSuperadmin(ctx);
    const antes = await contarSesionesDeSuperadmin(otro.id);

    const rafaga = await Promise.all(
      Array.from({ length: 50 }, () => ingresoSuperadminFallido(otro.usuario)),
    );
    exigirBloqueoEnRafaga(rafaga);

    const correcta = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: otro.usuario, contrasena: otro.contrasena });
    expect(correcta.status, correcta.text).toBe(429);
    expect(correcta.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    expect(correcta.body.token).toBeUndefined();
    expect(await contarSesionesDeSuperadmin(otro.id)).toBe(antes);
  });

  it('9 incorrectas en paralelo y, justo después, la correcta: responde 429 y no crea sesión', async () => {
    const otro = await nuevoSuperadmin(ctx);
    const antes = await contarSesionesDeSuperadmin(otro.id);

    const rafaga = await Promise.all(
      Array.from({ length: 9 }, () => ingresoSuperadminFallido(otro.usuario)),
    );
    exigirBloqueoEnRafaga(rafaga);

    const correcta = await ctx
      .http()
      .post('/plataforma/sesiones')
      .send({ usuario: otro.usuario, contrasena: otro.contrasena });
    expect(correcta.status, correcta.text).toBe(429);
    expect(correcta.body).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL' });
    expect(await contarSesionesDeSuperadmin(otro.id)).toBe(antes);
  });
});

// ------------------------------------------------------------------------------------------------
// O1 · criterio 42 y contrato ingresoRespuesta · la sesión de soporte es una sesionRespuesta
// ------------------------------------------------------------------------------------------------
describe('O1 · criterio 42 · la respuesta del soporte trae el mismo rol y los mismos permisos que GET /sesion', () => {
  async function abrirSoporte(sucursalId?: string) {
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .set(bearer(sa.token))
      .send({ motivo: `Soporte ${randomUUID()}`, ...(sucursalId ? { sucursalId } : {}) });
    exigirEstado(res, 201, 'abrir soporte');
    return res.body as { token: string; sesion: SesionRespuesta };
  }

  it('con sucursal activa: rol y permisos de la respuesta del soporte son los de GET /sesion', async () => {
    const { token, sesion } = await abrirSoporte(A.sucursales[0]!.id);
    const actual = await ctx.http().get('/sesion').set(bearer(token));
    exigirEstado(actual, 200, 'GET /sesion de soporte');
    const esperada = sesionRespuestaSchema.parse(actual.body);
    expect(sesion.rol).toBe(esperada.rol);
    expect(sesion.permisos).toEqual(esperada.permisos);
    expect(sesion.rol).toBe('ADMINISTRADOR');
    expect(sesion.permisos).not.toBeNull();
  });

  it('sin sucursal activa: rol y permisos de la respuesta del soporte son los de GET /sesion', async () => {
    const { token, sesion } = await abrirSoporte();
    const actual = await ctx.http().get('/sesion').set(bearer(token));
    exigirEstado(actual, 200, 'GET /sesion de soporte');
    const esperada = sesionRespuestaSchema.parse(actual.body);
    expect(sesion.rol).toBe(esperada.rol);
    expect(sesion.permisos).toEqual(esperada.permisos);
    // El esquema reserva `permisos: null` para "todavía no hay rol"; con rol ADMINISTRADOR no puede ser null.
    if (sesion.rol !== null) expect(sesion.permisos).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------
// O2 · criterios 61, 62, 66 a 68 · soporte de un superadministrador desactivado
// ------------------------------------------------------------------------------------------------
describe('O2 · soporte de un superadministrador desactivado', () => {
  it('con el superadministrador marcado inactivo y sin cerrar sus sesiones, la sesión de soporte responde 401 y no ejecuta nada', async () => {
    const soporteSa = await nuevoSuperadmin(ctx);
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${A.empresaId}/soporte`)
      .set(bearer(soporteSa.token))
      .send({ motivo: `Soporte ${randomUUID()}`, sucursalId: A.sucursales[0]!.id });
    exigirEstado(res, 201, 'abrir soporte');
    const token = res.body.token as string;
    exigirEstado(await ctx.http().get('/sesion').set(bearer(token)), 200, 'antes de desactivar');

    // La desactivación ganó la carrera contra el INSERT de la sesión de soporte: la fila de `sesion` sigue abierta.
    const marcado = await admin.query(
      'UPDATE superadministrador SET activo = false WHERE id = $1',
      [soporteSa.id],
    );
    expect(marcado.rowCount).toBe(1);
    const abierta = await admin.query<{ cerrada: boolean }>(
      'SELECT cerrada_en IS NOT NULL AS cerrada FROM sesion WHERE id = $1',
      [partesDeToken(token).sesionId],
    );
    expect(abierta.rows).toEqual([{ cerrada: false }]);

    // Una escritura con esa sesión no se ejecuta.
    const nombreUsuario = usuarioUnico('fantasma');
    const escritura = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(token))
      .send({
        nombre: 'No debe existir',
        nombreUsuario,
        esAdministrador: false,
        accesos: [{ sucursalId: A.sucursales[0]!.id, rol: 'MOZO' }],
        contrasenaTemporal: contrasenaUnica(),
      });
    expect(escritura.status, escritura.text).toBe(401);
    const creado = await admin.query('SELECT 1 FROM usuario WHERE nombre_usuario = $1', [
      nombreUsuario,
    ]);
    expect(creado.rowCount).toBe(0);

    // Y la lectura de la sesión tampoco.
    const lectura = await ctx.http().get('/sesion').set(bearer(token));
    expect(lectura.status, lectura.text).toBe(401);
    const cambioDeSucursal = await ctx
      .http()
      .put('/sesion/sucursal')
      .set(bearer(token))
      .send({ sucursalId: A.sucursales[1]!.id });
    expect(cambioDeSucursal.status, cambioDeSucursal.text).toBe(401);
  });
});
