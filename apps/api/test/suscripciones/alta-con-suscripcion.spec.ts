// Pruebas del desarrollador (no protegidas) de las tareas T26 y T27 · criterios 63, 64, 69, 70 y 85:
// cada sucursal nace con exactamente una suscripción (por plataforma: plan indicado o por defecto, con el
// vencimiento indicado o `sumarMeses(hoy, 1)`; por el Administrador: plan por defecto y vencimiento hoy),
// con la trazabilidad del actor, todo o nada y con idempotencia en las rutas que la aceptan.
import {
  altaEmpresaRespuestaSchema,
  planRespuestaSchema,
  sucursalPlataformaRespuestaSchema,
} from '@restaurante/contratos';
import { sumarMeses } from '@restaurante/dominio';
import { randomInt, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlataformaEmpresasService } from '../../src/modulos/plataforma';
import { abrirCliente } from '../utilidades';
import { rucAleatorio, textoUnico } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  bearer,
  cuerpoDeAlta,
  exigirEstado,
  filasDeAuditoria,
  nuevoSuperadmin,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';
import { datosDeEmpresa } from '../aislamiento/fabrica';

/** Jueves 31 de enero de 2030, 10:00 en Lima: un mes después es el 28 de febrero. */
const INICIO = '2030-01-31T10:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;
let empresa: EmpresaDePrueba;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO });
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
  empresa = await altaEmpresa(ctx, sa);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

interface FilaSuscripcion {
  id: string;
  empresa_id: string;
  sucursal_id: string;
  codigo: string;
  vencimiento: string;
  creado_por_usuario_id: string | null;
  creado_por_superadministrador_id: string | null;
  creado_por_sistema: string | null;
}

const suscripcionesDe = async (sucursalIds: string[]): Promise<FilaSuscripcion[]> =>
  (
    await admin.query<FilaSuscripcion>(
      `SELECT s.id, s.empresa_id, s.sucursal_id, p.codigo, s.vencimiento::text AS vencimiento,
              s.creado_por_usuario_id, s.creado_por_superadministrador_id, s.creado_por_sistema
         FROM suscripcion s JOIN plan p ON p.id = s.plan_id
        WHERE s.sucursal_id = ANY($1::uuid[]) ORDER BY s.vencimiento, s.id`,
      [sucursalIds],
    )
  ).rows;

/**
 * Código de establecimiento único dentro del proceso: el índice único es por (emisor, código) y todas las
 * sucursales de este archivo usan el mismo emisor, así que un número al azar podía repetirse (colisión rara
 * pero real). Se parte de un punto al azar (por si otra corrida dejó datos) y se avanza de uno en uno.
 */
let proximoCodigo = 3000 + randomInt(0, 3000);
const codigoUnico = (): string => String(proximoCodigo++);

const cuerpoDeSucursal = (e: EmpresaDePrueba, extra: Record<string, unknown> = {}) => ({
  rucEmisor: e.emisores[0]!.ruc,
  nombre: textoUnico('Sucursal-nueva'),
  codigoEstablecimiento: codigoUnico(),
  direccion: 'Av. Nueva 100',
  ...extra,
});

describe('alta de empresa por HTTP (criterios 63 y 69)', () => {
  it('cada sucursal queda con una suscripción BASE de un mes (28 de febrero) y estado ACTIVA, a nombre del superadministrador', async () => {
    const { sucursales, respuestaAlta } = empresa;
    const r = altaEmpresaRespuestaSchema.parse(respuestaAlta);
    expect(r.sucursales).toHaveLength(2);
    for (const s of r.sucursales) {
      expect(s.suscripcion).toMatchObject({
        sucursalId: s.id,
        empresaId: empresa.empresaId,
        plan: { codigo: 'BASE' },
        vencimiento: '2030-02-28',
        estado: 'ACTIVA',
        suspensionDesde: '2030-03-08',
        diasRestantesGracia: null,
      });
    }
    const filas = await suscripcionesDe(sucursales.map((s) => s.id));
    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f) => f.sucursal_id)).size).toBe(2);
    for (const f of filas) {
      expect(f).toMatchObject({
        empresa_id: empresa.empresaId,
        codigo: 'BASE',
        vencimiento: '2030-02-28',
        creado_por_superadministrador_id: sa.id,
        creado_por_sistema: null,
        creado_por_usuario_id: null,
      });
    }
    const auditoria = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'registrar_empresa'",
      [empresa.empresaId],
    );
    expect(auditoria).toHaveLength(1);
    expect(JSON.stringify(auditoria[0]!.detalle)).toContain('2030-02-28');
  });

  it('con el plan indicado y un vencimiento de hoy: el plan elegido, estado ACTIVA ese día y en gracia al siguiente', async () => {
    const plan = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send({
        codigo: `A-${randomUUID().slice(0, 8)}`,
        nombre: 'Plan del alta',
        diasGracia: 3,
        modulos: ['SALON'],
        porDefecto: false,
        activo: true,
        motivo: 'Plan para el alta',
      });
    exigirEstado(plan, 201, 'crear plan');
    const planId = planRespuestaSchema.parse(plan.body).id;
    const cuerpo = cuerpoDeAlta();
    cuerpo.sucursales[0]!.suscripcion = { planId, vencimiento: '2030-01-31' };
    const res = await ctx.http().post('/plataforma/empresas').set(bearer(sa.token)).send(cuerpo);
    exigirEstado(res, 201, 'alta con plan');
    const r = altaEmpresaRespuestaSchema.parse(res.body);
    const porNombre = Object.fromEntries(r.sucursales.map((s) => [s.nombre, s.suscripcion]));
    expect(porNombre[cuerpo.sucursales[0]!.nombre as string]).toMatchObject({
      plan: { id: planId },
      vencimiento: '2030-01-31',
      estado: 'ACTIVA',
      suspensionDesde: '2030-02-04',
    });
    // La otra sucursal, sin `suscripcion`, usa el plan por defecto y un mes.
    expect(porNombre[cuerpo.sucursales[1]!.nombre as string]).toMatchObject({
      plan: { codigo: 'BASE' },
      vencimiento: '2030-02-28',
    });
  });

  it('un plan inactivo responde 422 PLAN_INVALIDO y no deja nada creado ni auditado', async () => {
    const plan = await ctx
      .http()
      .post('/plataforma/planes')
      .set(bearer(sa.token))
      .send({
        codigo: `I-${randomUUID().slice(0, 8)}`,
        nombre: 'Plan inactivo',
        diasGracia: 7,
        modulos: ['SALON'],
        porDefecto: false,
        activo: false,
        motivo: 'Plan inactivo',
      });
    exigirEstado(plan, 201, 'crear plan inactivo');
    const cuerpo = cuerpoDeAlta();
    cuerpo.motivo = textoUnico('motivo-inactivo');
    cuerpo.sucursales[1]!.suscripcion = { planId: plan.body.id };
    const res = await ctx.http().post('/plataforma/empresas').set(bearer(sa.token)).send(cuerpo);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'PLAN_INVALIDO' });
    expect(
      (await admin.query('SELECT 1 FROM empresa WHERE nombre = $1', [cuerpo.nombre])).rows,
    ).toEqual([]);
    expect(await filasDeAuditoria(admin, 'motivo = $1', [cuerpo.motivo])).toHaveLength(0);
  });

  it('un vencimiento anterior a hoy responde 400 con el campo de la sucursal; el de ayer en UTC pero hoy en Lima sí vale', async () => {
    const cuerpo = cuerpoDeAlta();
    cuerpo.sucursales[1]!.suscripcion = { vencimiento: '2030-01-30' };
    const res = await ctx.http().post('/plataforma/empresas').set(bearer(sa.token)).send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body.campos).toContainEqual(
      expect.objectContaining({ campo: 'sucursales.1.suscripcion.vencimiento' }),
    );
    // 2030-01-31 23:30 en Lima ya es 1 de febrero en UTC: hoy sigue siendo el 31 de enero.
    ctx.reloj.fijar('2030-01-31T23:30:00-05:00');
    try {
      const vigente = await nuevoSuperadmin(ctx);
      const hoy = cuerpoDeAlta();
      hoy.sucursales[0]!.suscripcion = { vencimiento: '2030-01-31' };
      exigirEstado(
        await ctx.http().post('/plataforma/empresas').set(bearer(vigente.token)).send(hoy),
        201,
        'vencimiento de hoy en Lima',
      );
    } finally {
      ctx.reloj.fijar(INICIO);
    }
  });

  it('PlataformaEmpresasService.registrarEmpresa (semilla y scripts) también crea la suscripción y conserva su respuesta', async () => {
    const servicio = ctx.app.get(PlataformaEmpresasService);
    const resultado = await servicio.registrarEmpresa(datosDeEmpresa({ sucursalesPorEmisor: 3 }), {
      actor: textoUnico('actor-semilla'),
      motivo: 'Alta por la semilla',
    });
    expect(resultado.sucursales).toHaveLength(3);
    for (const s of resultado.sucursales) expect(Object.keys(s).sort()).toEqual(['id', 'nombre']);
    const filas = await suscripcionesDe(resultado.sucursales.map((s) => s.id));
    expect(filas).toHaveLength(3);
    for (const f of filas) {
      expect(f).toMatchObject({ codigo: 'BASE', vencimiento: '2030-02-28' });
      expect(f.creado_por_sistema).toMatch(/^actor-semilla/);
    }
  });
});

describe('POST /plataforma/empresas/:id/sucursales (criterio 64)', () => {
  const enviar = (cuerpo: Record<string, unknown>, clave?: string) => {
    const peticion = ctx
      .http()
      .post(`/plataforma/empresas/${empresa.empresaId}/sucursales`)
      .set(bearer(sa.token));
    return (clave === undefined ? peticion : peticion.set('Idempotency-Key', clave)).send(cuerpo);
  };

  it('crea la sucursal con su suscripción (plan por defecto y un mes si no se indica) y la audita', async () => {
    const motivo = textoUnico('motivo-sucursal');
    const res = await enviar({ ...cuerpoDeSucursal(empresa), motivo });
    exigirEstado(res, 201, 'agregar sucursal');
    const r = sucursalPlataformaRespuestaSchema.parse(res.body);
    expect(r.suscripcion).toMatchObject({
      sucursalId: r.id,
      plan: { codigo: 'BASE' },
      vencimiento: sumarMeses('2030-01-31', 1),
      estado: 'ACTIVA',
    });
    const filas = await suscripcionesDe([r.id]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ creado_por_superadministrador_id: sa.id });
    const auditoria = await filasDeAuditoria(admin, "accion = 'agregar_sucursal' AND motivo = $1", [
      motivo,
    ]);
    expect(auditoria).toHaveLength(1);
    expect(JSON.stringify(auditoria[0]!.detalle)).toContain(r.suscripcion.id);
  });

  it('un plan inexistente responde 422 PLAN_INVALIDO y no crea la sucursal', async () => {
    const cuerpo = {
      ...cuerpoDeSucursal(empresa),
      suscripcion: { planId: randomUUID() },
      motivo: 'Plan',
    };
    const res = await enviar(cuerpo);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ codigo: 'PLAN_INVALIDO' });
    expect(
      (await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [cuerpo.nombre])).rows,
    ).toEqual([]);
  });

  it('un vencimiento anterior a hoy responde 400 y no crea la sucursal', async () => {
    const cuerpo = {
      ...cuerpoDeSucursal(empresa),
      suscripcion: { vencimiento: '2030-01-01' },
      motivo: 'Vencimiento',
    };
    const res = await enviar(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body.campos).toContainEqual(
      expect.objectContaining({ campo: 'suscripcion.vencimiento' }),
    );
    expect(
      (await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [cuerpo.nombre])).rows,
    ).toEqual([]);
  });

  it('con la misma Idempotency-Key y el mismo cuerpo crea una sola sucursal con una sola suscripción', async () => {
    const clave = randomUUID();
    const cuerpo = { ...cuerpoDeSucursal(empresa), motivo: textoUnico('motivo-idem') };
    const primera = await enviar(cuerpo, clave);
    exigirEstado(primera, 201, 'primera');
    const segunda = await enviar(cuerpo, clave);
    exigirEstado(segunda, 201, 'repetida');
    expect(segunda.body).toEqual(primera.body);
    expect(
      (await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [cuerpo.nombre])).rows,
    ).toHaveLength(1);
    expect(await suscripcionesDe([primera.body.id])).toHaveLength(1);
    expect(
      await filasDeAuditoria(admin, "accion = 'agregar_sucursal' AND motivo = $1", [cuerpo.motivo]),
    ).toHaveLength(1);
  });

  it('la misma clave con otro cuerpo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const clave = randomUUID();
    exigirEstado(
      await enviar({ ...cuerpoDeSucursal(empresa), motivo: 'uno' }, clave),
      201,
      'primera',
    );
    const otra = await enviar({ ...cuerpoDeSucursal(empresa), motivo: 'dos' }, clave);
    expect(otra.status).toBe(422);
    expect(otra.body).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
  });
});

describe('POST /sucursales del Administrador (criterio 70)', () => {
  const crear = (cuerpo: Record<string, unknown>, clave?: string) => {
    const peticion = ctx.http().post('/sucursales').set(bearer(empresa.admin.token));
    return (clave === undefined ? peticion : peticion.set('Idempotency-Key', clave)).send(cuerpo);
  };

  it('nace con suscripción en el plan por defecto y vencimiento hoy, a nombre del Administrador, y se audita', async () => {
    const res = await crear(cuerpoDeSucursal(empresa));
    exigirEstado(res, 201, 'crear sucursal');
    // La respuesta es la de 001: sin la suscripción.
    expect(Object.keys(res.body)).not.toContain('suscripcion');
    const filas = await suscripcionesDe([res.body.id]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      empresa_id: empresa.empresaId,
      codigo: 'BASE',
      vencimiento: '2030-01-31',
      creado_por_usuario_id: empresa.admin.id,
      creado_por_superadministrador_id: null,
    });
    const auditoria = await filasDeAuditoria(
      admin,
      "empresa_id = $1 AND accion = 'crear_sucursal' AND entidad_id = $2",
      [empresa.empresaId, res.body.id],
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]!.detalle).toMatchObject({
      suscripcion: { id: filas[0]!.id, vencimiento: '2030-01-31' },
    });
  });

  it('vence hoy: activa hoy y en gracia desde el día siguiente (criterios 70 y 71)', async () => {
    const res = await crear(cuerpoDeSucursal(empresa));
    exigirEstado(res, 201, 'crear sucursal');
    const estadoEn = async (instante: string) => {
      ctx.reloj.fijar(instante);
      const vigente = await nuevoSuperadmin(ctx);
      const lista = await ctx.http().get('/plataforma/suscripciones').set(bearer(vigente.token));
      const fila = (lista.body as { sucursalId: string; estado: string }[]).find(
        (f) => f.sucursalId === res.body.id,
      );
      return fila?.estado;
    };
    try {
      expect(await estadoEn('2030-01-31T23:59:00-05:00')).toBe('ACTIVA');
      expect(await estadoEn('2030-02-01T00:00:00-05:00')).toBe('EN_GRACIA');
    } finally {
      ctx.reloj.fijar(INICIO);
    }
  });

  it('el Administrador no puede enviar `suscripcion` (400) ni crear una sucursal con un emisor ajeno (422): nada queda creado', async () => {
    const conSuscripcion = {
      ...cuerpoDeSucursal(empresa),
      suscripcion: { vencimiento: '2031-01-01' },
    };
    expect((await crear(conSuscripcion)).status).toBe(400);
    const ajeno = { ...cuerpoDeSucursal(empresa), rucEmisor: rucAleatorio() };
    expect((await crear(ajeno)).status).toBe(422);
    for (const c of [conSuscripcion, ajeno]) {
      expect(
        (await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [c.nombre])).rows,
      ).toEqual([]);
    }
  });

  it('un código de establecimiento repetido responde 409 y no deja una suscripción huérfana', async () => {
    const primera = await crear(cuerpoDeSucursal(empresa));
    exigirEstado(primera, 201, 'crear sucursal');
    const repetida = await crear({
      ...cuerpoDeSucursal(empresa),
      codigoEstablecimiento: primera.body.codigoEstablecimiento,
    });
    expect(repetida.status).toBe(409);
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sucursal s LEFT JOIN suscripcion u ON u.sucursal_id = s.id
        WHERE s.empresa_id = $1 AND u.id IS NULL`,
      [empresa.empresaId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('con la misma Idempotency-Key crea una sola sucursal con una sola suscripción', async () => {
    const clave = randomUUID();
    const cuerpo = cuerpoDeSucursal(empresa);
    const primera = await crear(cuerpo, clave);
    exigirEstado(primera, 201, 'primera');
    const segunda = await crear(cuerpo, clave);
    exigirEstado(segunda, 201, 'repetida');
    expect(segunda.body).toEqual(primera.body);
    expect(await suscripcionesDe([primera.body.id])).toHaveLength(1);
  });
});
