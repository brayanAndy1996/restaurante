// Pruebas del desarrollador (no protegidas) de I-5: trazabilidad de `POST /usuarios` y de
// `POST /usuarios/:id/contrasena` (rutas `@SinEmpresa()` que abren su propia transacción con el actor de la
// sesión) y criterio 87 (una clave de idempotencia en `POST /usuarios` no guarda nada).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  altaEmpresa,
  arrancar,
  bearer,
  contrasenaUnica,
  crearUsuarioConSesion,
  exigirEstado,
  filaPorId,
  filasDeAuditoria,
  nuevoSuperadmin,
  recordarEquipo,
  usuarioUnico,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;

beforeAll(async () => {
  ctx = await arrancar();
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

interface Actor {
  usuario: string | null;
  equipo: string | null;
  superadministrador: string | null;
  sistema: string | null;
}
const actorDe = (
  fila: Record<string, unknown>,
  grupo: 'creado_por' | 'actualizado_por',
): Actor => ({
  usuario: fila[`${grupo}_usuario_id`] as string | null,
  equipo: fila[`${grupo}_equipo_id`] as string | null,
  superadministrador: fila[`${grupo}_superadministrador_id`] as string | null,
  sistema: fila[`${grupo}_sistema`] as string | null,
});
const deUsuario = (usuario: string, equipo: string | null = null): Actor => ({
  usuario,
  equipo,
  superadministrador: null,
  sistema: null,
});
const deSuperadmin = (id: string): Actor => ({
  usuario: null,
  equipo: null,
  superadministrador: id,
  sistema: null,
});

/** `POST /usuarios` con el token dado; devuelve el id del usuario creado. */
async function crear(token: string, empresa: EmpresaDePrueba): Promise<string> {
  const res = await ctx
    .http()
    .post('/usuarios')
    .set(bearer(token))
    .send({
      nombre: 'Persona de la trazabilidad',
      nombreUsuario: usuarioUnico('traza'),
      esAdministrador: false,
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
      contrasenaTemporal: contrasenaUnica(),
    });
  exigirEstado(res, 201, 'POST /usuarios');
  return res.body.id as string;
}

/** `POST /usuarios/:id/contrasena` con el token dado. */
async function restablecer(token: string, usuarioId: string): Promise<void> {
  const res = await ctx
    .http()
    .post(`/usuarios/${usuarioId}/contrasena`)
    .set(bearer(token))
    .send({ contrasenaTemporal: contrasenaUnica() });
  exigirEstado(res, 204, 'POST /usuarios/:id/contrasena');
}

async function soporteDe(empresa: EmpresaDePrueba): Promise<string> {
  const res = await ctx
    .http()
    .post(`/plataforma/empresas/${empresa.empresaId}/soporte`)
    .set(bearer(sa.token))
    .send({ motivo: `Soporte de trazabilidad ${randomUUID()}` });
  exigirEstado(res, 201, 'abrir soporte');
  return res.body.token as string;
}

const auditoriaDe = (empresa: EmpresaDePrueba, accion: string, entidadId: string) =>
  filasDeAuditoria(admin, 'empresa_id = $1 AND accion = $2 AND entidad_id = $3', [
    empresa.empresaId,
    accion,
    entidadId,
  ]);

describe('POST /usuarios · trazabilidad y auditoría con el actor de la sesión', () => {
  it('Administrador sin equipo: la fila queda creada y cambiada por él, sin equipo, y la auditoría lleva el mismo actor', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crear(empresa.admin.token, empresa);
    const fila = (await filaPorId(admin, 'usuario', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id));
    const auditoria = await auditoriaDe(empresa, 'crear_usuario', id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_usuario_id: empresa.admin.id,
      equipo_id: null,
      actor_superadministrador_id: null,
      actor_sistema: null,
    });
  });

  it('Administrador con equipo recordado: creado_por_equipo_id es ese equipo y la auditoría lo repite', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const { equipo } = await recordarEquipo(ctx, empresa.admin.token, { nombre: 'Tablet de caja' });
    const id = await crear(empresa.admin.token, empresa);
    const fila = (await filaPorId(admin, 'usuario', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id, equipo.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(empresa.admin.id, equipo.id));
    const auditoria = await auditoriaDe(empresa, 'crear_usuario', id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_usuario_id: empresa.admin.id,
      equipo_id: equipo.id,
    });
  });

  it('soporte: creado_por_superadministrador_id es quien da el soporte, sin usuario, y la auditoría lleva al superadministrador', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crear(await soporteDe(empresa), empresa);
    const fila = (await filaPorId(admin, 'usuario', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deSuperadmin(sa.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deSuperadmin(sa.id));
    const auditoria = await auditoriaDe(empresa, 'crear_usuario', id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
      equipo_id: null,
      actor_sistema: null,
    });
  });
});

describe('POST /usuarios/:id/contrasena · trazabilidad y auditoría con el actor de la sesión', () => {
  it('otro Administrador (con equipo) cambia solo actualizado_por_*; creado_por_* sigue siendo de quien creó al usuario', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crear(empresa.admin.token, empresa);
    const otro = await crearUsuarioConSesion(ctx, empresa.admin.token, { esAdministrador: true });
    const { equipo } = await recordarEquipo(ctx, otro.token, {
      nombre: 'Celular del segundo Administrador',
    });
    await restablecer(otro.token, id);
    const fila = (await filaPorId(admin, 'usuario', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deUsuario(otro.id, equipo.id));
    const auditoria = await auditoriaDe(empresa, 'restablecer_contrasena', id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_usuario_id: otro.id,
      equipo_id: equipo.id,
      actor_superadministrador_id: null,
    });
  });

  it('soporte: actualizado_por_superadministrador_id es quien da el soporte y la auditoría lo repite', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crear(empresa.admin.token, empresa);
    await restablecer(await soporteDe(empresa), id);
    const fila = (await filaPorId(admin, 'usuario', id))!;
    expect(actorDe(fila, 'creado_por')).toEqual(deUsuario(empresa.admin.id));
    expect(actorDe(fila, 'actualizado_por')).toEqual(deSuperadmin(sa.id));
    const auditoria = await auditoriaDe(empresa, 'restablecer_contrasena', id);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      actor_superadministrador_id: sa.id,
      actor_usuario_id: null,
    });
  });
});

describe('criterio 87 · Idempotency-Key en rutas que no la guardan', () => {
  const idempotenciaDe = async (empresa: EmpresaDePrueba) =>
    (
      await admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM idempotencia WHERE empresa_id = $1',
        [empresa.empresaId],
      )
    ).rows[0]!.n;

  it('POST /usuarios con la misma clave: 201 y luego 409 CONFLICTO (el nombre ya existe), sin guardar nada en idempotencia', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const clave = randomUUID();
    const cuerpo = {
      nombre: 'Persona con clave',
      nombreUsuario: usuarioUnico('idem'),
      esAdministrador: false,
      accesos: [{ sucursalId: empresa.sucursales[0]!.id, rol: 'MOZO' }],
      contrasenaTemporal: contrasenaUnica(),
    };
    const primera = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(empresa.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    exigirEstado(primera, 201, 'primer POST /usuarios con clave');
    const segunda = await ctx
      .http()
      .post('/usuarios')
      .set(bearer(empresa.admin.token))
      .set('Idempotency-Key', clave)
      .send(cuerpo);
    exigirEstado(segunda, 409, 'segundo POST /usuarios con la misma clave');
    expect(segunda.body).toMatchObject({ codigo: 'CONFLICTO' });
    expect(await idempotenciaDe(empresa)).toBe(0);
  });

  it('POST /usuarios/:id/contrasena con clave tampoco guarda nada: repetirlo vuelve a restablecer (204 las dos veces)', async () => {
    const empresa = await altaEmpresa(ctx, sa);
    const id = await crear(empresa.admin.token, empresa);
    const clave = randomUUID();
    for (let vez = 0; vez < 2; vez++) {
      const res = await ctx
        .http()
        .post(`/usuarios/${id}/contrasena`)
        .set(bearer(empresa.admin.token))
        .set('Idempotency-Key', clave)
        .send({ contrasenaTemporal: contrasenaUnica() });
      exigirEstado(res, 204, `restablecer ${vez + 1}`);
    }
    expect(await idempotenciaDe(empresa)).toBe(0);
    // Cada restablecimiento dejó su fila de auditoría.
    expect(await auditoriaDe(empresa, 'restablecer_contrasena', id)).toHaveLength(2);
  });
});
