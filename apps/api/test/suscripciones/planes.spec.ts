// Pruebas del desarrollador (no protegidas) de la tarea T28 · criterio 75: planes por HTTP.
// `GET`, `POST` y `PATCH /plataforma/planes`: siempre hay exactamente un plan por defecto activo, el cambio
// de plan por defecto quita la marca al anterior, los módulos fuera del catálogo se rechazan y cada
// escritura deja su fila de auditoría sin empresa.
// Estas pruebas cambian el plan por defecto, que es global: por eso corren en una base de datos propia
// (nueva, con todas las migraciones) y no en la base compartida con los demás archivos, que suponen que el
// plan por defecto es `BASE`.
import { planRespuestaSchema } from '@restaurante/contratos';
import { MODULOS } from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { RelojManual } from '../../src/nucleo/reloj';
import { fijarEntornoDePrueba, urlDeRol } from '../utilidades';
import { textoUnico } from '../aislamiento/fabrica';
import {
  bearer,
  crearBaseNueva,
  exigirEstado,
  filasDeAuditoria,
  migrarHasta,
  nuevoSuperadmin,
  type AppDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;
let base: Awaited<ReturnType<typeof crearBaseNueva>>;

beforeAll(async () => {
  base = await crearBaseNueva('planes');
  await migrarHasta(base.base);
  fijarEntornoDePrueba({
    poolMax: 2,
    empresaPorHeader: false,
    extra: {
      DATABASE_URL: urlDeRol('api', base.base),
      DATABASE_PLATAFORMA_URL: urlDeRol('plataforma', base.base),
    },
  });
  const reloj = new RelojManual('2030-05-15T10:00:00-05:00');
  const app = await crearAplicacion({ reloj, logger: false });
  ctx = { app, reloj, http: () => request(app.getHttpServer()), cerrar: () => app.close() };
  admin = new Client({ connectionString: urlDeRol('admin', base.base) });
  await admin.connect();
  sa = await nuevoSuperadmin(ctx);
}, 120_000);

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await base?.eliminar();
});

const codigoUnico = () => `T-${randomUUID().slice(0, 8)}`;

const planNuevo = (extra: Record<string, unknown> = {}) => ({
  codigo: codigoUnico(),
  nombre: 'Plan de prueba',
  diasGracia: 7,
  modulos: ['SALON'],
  porDefecto: false,
  activo: true,
  motivo: textoUnico('motivo-plan'),
  ...extra,
});

const crearPlan = async (extra: Record<string, unknown> = {}) => {
  const res = await ctx
    .http()
    .post('/plataforma/planes')
    .set(bearer(sa.token))
    .send(planNuevo(extra));
  exigirEstado(res, 201, 'crear plan');
  return planRespuestaSchema.parse(res.body);
};

const listar = async () => {
  const res = await ctx.http().get('/plataforma/planes').set(bearer(sa.token));
  exigirEstado(res, 200, 'listar planes');
  return planRespuestaSchema.array().parse(res.body);
};

const modificar = (id: string, cuerpo: Record<string, unknown>) =>
  ctx
    .http()
    .patch(`/plataforma/planes/${id}`)
    .set(bearer(sa.token))
    .send({ motivo: textoUnico('motivo-cambio'), ...cuerpo });

const restaurarBase = async () => {
  const base = (await listar()).find((p) => p.codigo === 'BASE')!;
  if (!base.porDefecto)
    exigirEstado(await modificar(base.id, { porDefecto: true }), 200, 'restaurar BASE');
};

describe('GET /plataforma/planes', () => {
  it('lista el plan BASE (por defecto, todos los módulos, 7 días de gracia, sin precios) primero', async () => {
    await crearPlan();
    const planes = await listar();
    expect(planes[0]!.porDefecto).toBe(true);
    expect(planes.filter((p) => p.porDefecto)).toHaveLength(1);
    const base = planes.find((p) => p.codigo === 'BASE')!;
    expect(base).toMatchObject({
      nombre: 'Plan base',
      diasGracia: 7,
      precioMensual: null,
      cuotaComprobantesMes: null,
      precioExcedente: null,
      activo: true,
    });
    expect([...base.modulos].sort()).toEqual([...MODULOS].sort());
  });

  it('sin sesión de superadministrador responde 401', async () => {
    expect((await ctx.http().get('/plataforma/planes')).status).toBe(401);
  });
});

describe('POST /plataforma/planes', () => {
  it('crea el plan (201) con precios como texto, módulos sin repetir y su fila de auditoría sin empresa', async () => {
    const motivo = textoUnico('motivo-crear');
    const res = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send(
        planNuevo({
          modulos: ['SALON', 'CAJA', 'SALON'],
          precioMensual: '49.90',
          cuotaComprobantesMes: 300,
          precioExcedente: '0.1500',
          diasGracia: 15,
          motivo,
        }),
      );
    exigirEstado(res, 201, 'crear plan');
    const plan = planRespuestaSchema.parse(res.body);
    expect(plan).toMatchObject({
      precioMensual: '49.90',
      cuotaComprobantesMes: 300,
      precioExcedente: '0.1500',
      diasGracia: 15,
      modulos: ['SALON', 'CAJA'],
      porDefecto: false,
      activo: true,
    });
    const filas = await filasDeAuditoria(admin, "accion = 'crear_plan' AND motivo = $1", [motivo]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      origen: 'plataforma',
      empresa_id: null,
      actor_superadministrador_id: sa.id,
      entidad: 'plan',
      entidad_id: plan.id,
    });
  });

  it.each([
    ['un módulo fuera del catálogo', { modulos: ['VENTAS'] }],
    ['más de 60 días de gracia', { diasGracia: 61 }],
    ['días de gracia negativos', { diasGracia: -1 }],
    ['un precio con 3 decimales', { precioMensual: '10.123' }],
    ['una cuota negativa', { cuotaComprobantesMes: -1 }],
    ['un código vacío', { codigo: '  ' }],
    ['un campo desconocido', { empresaId: randomUUID() }],
    ['sin motivo', { motivo: undefined }],
  ])('%s responde 400 y no crea nada', async (_nombre, extra) => {
    const cuerpo = planNuevo(extra);
    const res = await ctx.http().post('/plataforma/planes').set(bearer(sa.token)).send(cuerpo);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
    // Otros archivos crean planes a la vez: se mira solo el código de esta prueba.
    expect(
      (await admin.query('SELECT 1 FROM plan WHERE codigo = $1', [cuerpo.codigo])).rows,
    ).toEqual([]);
  });

  it('un código repetido responde 409 CONFLICTO y no deja otra fila de auditoría', async () => {
    const plan = await crearPlan();
    const motivo = textoUnico('motivo-repetido');
    const res = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send(planNuevo({ codigo: plan.codigo, motivo }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'CONFLICTO' });
    expect(await filasDeAuditoria(admin, 'motivo = $1', [motivo])).toHaveLength(0);
  });

  it('un plan por defecto inactivo responde 409 y no cambia el plan por defecto', async () => {
    const res = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send(planNuevo({ porDefecto: true, activo: false }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'CONFLICTO' });
    expect((await listar()).filter((p) => p.porDefecto)).toHaveLength(1);
  });

  it('un plan nuevo por defecto quita la marca al anterior: siempre hay exactamente uno', async () => {
    try {
      const nuevo = await crearPlan({ porDefecto: true, nombre: 'Nuevo por defecto' });
      const porDefecto = (await listar()).filter((p) => p.porDefecto);
      expect(porDefecto.map((p) => p.id)).toEqual([nuevo.id]);
    } finally {
      await restaurarBase();
    }
    expect((await listar()).filter((p) => p.porDefecto).map((p) => p.codigo)).toEqual(['BASE']);
  });

  it('un código repetido con porDefecto no quita la marca al plan por defecto (todo o nada)', async () => {
    const res = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send(planNuevo({ codigo: 'BASE', porDefecto: true }));
    expect(res.status).toBe(409);
    expect((await listar()).filter((p) => p.porDefecto).map((p) => p.codigo)).toEqual(['BASE']);
  });
});

describe('PATCH /plataforma/planes/:id', () => {
  it('cambia los campos enviados, deja el antes y el después en la auditoría y respeta lo demás', async () => {
    const plan = await crearPlan({ precioMensual: '20.00', cuotaComprobantesMes: 100 });
    const motivo = textoUnico('motivo-modificar');
    const res = await modificar(plan.id, {
      nombre: 'Plan cambiado',
      cuotaComprobantesMes: null,
      modulos: ['SALON', 'COCINA'],
      motivo,
    });
    exigirEstado(res, 200, 'modificar plan');
    const cambiado = planRespuestaSchema.parse(res.body);
    expect(cambiado).toMatchObject({
      id: plan.id,
      codigo: plan.codigo,
      nombre: 'Plan cambiado',
      precioMensual: '20.00',
      cuotaComprobantesMes: null,
      modulos: ['SALON', 'COCINA'],
    });
    const filas = await filasDeAuditoria(admin, "accion = 'modificar_plan' AND motivo = $1", [
      motivo,
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ empresa_id: null, actor_superadministrador_id: sa.id });
    expect(filas[0]!.detalle).toMatchObject({
      antes: { nombre: 'Plan de prueba', cuotaComprobantesMes: 100 },
      despues: { nombre: 'Plan cambiado', cuotaComprobantesMes: null },
    });
  });

  it('un plan inexistente responde 404; sin motivo o con un módulo inválido, 400', async () => {
    const plan = await crearPlan();
    expect((await modificar(randomUUID(), { nombre: 'X' })).status).toBe(404);
    const sinMotivo = await ctx
      .http()
      .patch(`/plataforma/planes/${plan.id}`)
      .set(bearer(sa.token))
      .send({ nombre: 'Sin motivo' });
    expect(sinMotivo.status).toBe(400);
    expect((await modificar(plan.id, { modulos: ['NADA'] })).status).toBe(400);
  });

  it('cambiar el código a uno repetido responde 409 y no cambia nada', async () => {
    const a = await crearPlan();
    const b = await crearPlan();
    const res = await modificar(b.id, { codigo: a.codigo });
    expect(res.status).toBe(409);
    expect((await listar()).find((p) => p.id === b.id)!.codigo).toBe(b.codigo);
  });

  it('desactivar el plan por defecto o quitarle la marca sin dar otro responde 409 y nada cambia', async () => {
    const base = (await listar()).find((p) => p.codigo === 'BASE')!;
    expect(base.porDefecto).toBe(true);
    const desactivar = await modificar(base.id, { activo: false });
    expect(desactivar.status).toBe(409);
    expect(desactivar.body).toMatchObject({ codigo: 'CONFLICTO' });
    const quitar = await modificar(base.id, { porDefecto: false });
    expect(quitar.status).toBe(409);
    const despues = (await listar()).find((p) => p.codigo === 'BASE')!;
    expect(despues).toMatchObject({ porDefecto: true, activo: true });
  });

  it('marcar otro plan como por defecto le quita la marca al anterior; uno inactivo no puede serlo', async () => {
    const otro = await crearPlan();
    const inactivo = await crearPlan({ activo: false });
    const inv = await modificar(inactivo.id, { porDefecto: true });
    expect(inv.status).toBe(409);
    try {
      exigirEstado(await modificar(otro.id, { porDefecto: true }), 200, 'marcar por defecto');
      expect((await listar()).filter((p) => p.porDefecto).map((p) => p.id)).toEqual([otro.id]);
      // El que ya no es el por defecto sí se puede desactivar.
      const base = (await listar()).find((p) => p.codigo === 'BASE')!;
      exigirEstado(await modificar(base.id, { activo: false }), 200, 'desactivar BASE');
      exigirEstado(await modificar(base.id, { activo: true }), 200, 'reactivar BASE');
    } finally {
      await restaurarBase();
    }
    expect((await listar()).filter((p) => p.porDefecto).map((p) => p.codigo)).toEqual(['BASE']);
  });
});
