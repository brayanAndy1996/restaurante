// Pruebas del desarrollador (no protegidas) de T8: `AuditoriaService.registrar`, la auditoría de
// `OperacionPlataforma` en la tabla `auditoria` (con su actor de texto o de superadministrador, la hora del
// reloj de la API y todo o nada) y que el actor de la fila lo pone la base, no la API.
import { Controller, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditoriaService, insertarAuditoriaPlataforma } from '../../src/modulos/auditoria';
import { OperacionPlataforma, PlataformaEmpresasService } from '../../src/modulos/plataforma';
import { SoloAdministrador } from '../../src/modulos/seguridad';
import { ContextoEmpresa, ContextoEmpresaAusenteError } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import { arrancar, bearer, type AppDePrueba } from '../acceso/fabrica-plataforma';
import {
  crearEmpresaSql,
  datosDeEmpresa,
  errorDe,
  textoUnico,
  type EmpresaSql,
} from '../aislamiento/fabrica';
import {
  insertarEquipo,
  insertarSesion,
  insertarSuperadministrador,
  insertarUsuario,
} from './sembrado';

const INICIO = '2031-05-12T09:30:00-05:00';

@Controller('sonda-auditoria-servicio')
class SondaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Post('bien')
  @SoloAdministrador()
  async bien() {
    await this.auditoria.registrar({
      accion: 'sonda_bien',
      motivo: 'sonda',
      entidad: 'sonda',
      detalle: { antes: 1, despues: 2 },
    });
    return { ok: true };
  }

  @Post('falla')
  @SoloAdministrador()
  async falla(): Promise<never> {
    await this.auditoria.registrar({ accion: 'sonda_falla' });
    throw new Error('falla a propósito después de auditar');
  }
}

let ctx: AppDePrueba;
let admin: Client;
let api: Client;
let plataformaCliente: Client;
let A: EmpresaSql;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO, controladoresExtra: [SondaController] });
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  plataformaCliente = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataformaCliente);
});

afterAll(async () => {
  await ctx?.cerrar();
  for (const c of [admin, api, plataformaCliente]) await c?.end();
});

const filas = async (condicion: string, parametros: unknown[]) =>
  (await admin.query(`SELECT * FROM auditoria WHERE ${condicion} ORDER BY ocurrido_en`, parametros))
    .rows;

describe('AuditoriaService.registrar (sesión de usuario)', () => {
  it('deja una fila con la empresa, la sesión, la sucursal activa, el equipo y el actor de la sesión, con la hora del reloj', async () => {
    const usuario = await insertarUsuario(api, A.id, { esAdministrador: true });
    const { equipoId, equipoRecordadoId } = await insertarEquipo(api, A.id, usuario.id);
    const sesion = await insertarSesion(api, A.id, {
      usuarioId: usuario.id,
      sucursalId: A.sucursales[0]!.id,
      equipoId,
      equipoRecordadoId,
      ahora: ctx.reloj.ahora(),
    });
    ctx.reloj.avanzar(3 * 60_000);
    const res = await ctx.http().post('/sonda-auditoria-servicio/bien').set(bearer(sesion.token));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [fila] = await filas('accion = $1 AND sesion_id = $2', ['sonda_bien', sesion.id]);
    expect(fila).toMatchObject({
      empresa_id: A.id,
      sucursal_id: A.sucursales[0]!.id,
      origen: 'empresa',
      actor_usuario_id: usuario.id,
      actor_superadministrador_id: null,
      actor_sistema: null,
      equipo_id: equipoId,
      motivo: 'sonda',
      entidad: 'sonda',
      detalle: { antes: 1, despues: 2 },
    });
    expect((fila.ocurrido_en as Date).getTime()).toBe(ctx.reloj.ahora().getTime());
  });

  it('si la acción falla después de auditar, no queda la fila (misma transacción)', async () => {
    const usuario = await insertarUsuario(api, A.id, { esAdministrador: true });
    const sesion = await insertarSesion(api, A.id, {
      usuarioId: usuario.id,
      ahora: ctx.reloj.ahora(),
    });
    const res = await ctx.http().post('/sonda-auditoria-servicio/falla').set(bearer(sesion.token));
    expect(res.status).toBe(500);
    expect(await filas('accion = $1 AND sesion_id = $2', ['sonda_falla', sesion.id])).toEqual([]);
  });

  it('en soporte el actor es el superadministrador y la fila lleva el id de la sesión de soporte', async () => {
    const superadmin = await insertarSuperadministrador(plataformaCliente);
    const sesion = await insertarSesion(api, A.id, {
      superadministradorId: superadmin,
      ahora: ctx.reloj.ahora(),
    });
    const res = await ctx.http().post('/sonda-auditoria-servicio/bien').set(bearer(sesion.token));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [fila] = await filas('sesion_id = $1', [sesion.id]);
    expect(fila).toMatchObject({
      actor_superadministrador_id: superadmin,
      actor_usuario_id: null,
      actor_sistema: null,
      equipo_id: null,
      empresa_id: A.id,
    });
  });

  it('fuera de un contexto de empresa lanza ContextoEmpresaAusenteError y con una acción vacía, un error', async () => {
    const servicio = ctx.app.get(AuditoriaService);
    await expect(servicio.registrar({ accion: 'x' })).rejects.toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    await expect(
      ctx.app.get(ContextoEmpresa).ejecutar(A.id, () => servicio.registrar({ accion: '  ' }), {
        actor: { sistema: 'prueba' },
      }),
    ).rejects.toThrow(/acción/);
  });

  it('con una sucursal de otra empresa la fila se rechaza (llave compuesta) y no se guarda', async () => {
    const otra = await crearEmpresaSql(plataformaCliente);
    const servicio = ctx.app.get(AuditoriaService);
    const marca = textoUnico('cruzada');
    await expect(
      ctx.app
        .get(ContextoEmpresa)
        .ejecutar(
          A.id,
          () => servicio.registrar({ accion: marca, sucursalId: otra.sucursales[0]!.id }),
          { actor: { sistema: 'prueba' } },
        ),
    ).rejects.toThrow();
    expect(await filas('accion = $1', [marca])).toEqual([]);
  });
});

describe('el actor de la fila lo pone la base', () => {
  it('lo que se envíe en las columnas del actor y del equipo se ignora', async () => {
    const impostor = randomUUID();
    await api.query('BEGIN');
    try {
      await api.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'actor-real')");
      await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      await api.query(
        `INSERT INTO auditoria (empresa_id, ocurrido_en, origen, accion, actor_usuario_id,
                                actor_sistema, equipo_id, detalle)
         VALUES ($1, now(), 'empresa', 'actor_ignorado', $2, 'impostor', $2, '{}'::jsonb)`,
        [A.id, impostor],
      );
      await api.query('COMMIT');
    } catch (error) {
      await api.query('ROLLBACK');
      throw error;
    }
    const [fila] = await filas('accion = $1', ['actor_ignorado']);
    expect(fila).toMatchObject({
      actor_sistema: 'actor-real',
      actor_usuario_id: null,
      equipo_id: null,
    });
  });

  it('sin actor la inserción falla con 42501 "contexto de actor ausente"', async () => {
    await api.query('BEGIN');
    try {
      await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      const error = await errorDe(
        api.query(
          `INSERT INTO auditoria (empresa_id, ocurrido_en, origen, accion, detalle)
           VALUES ($1, now(), 'empresa', 'sin_actor', '{}'::jsonb)`,
          [A.id],
        ),
      );
      expect(error.code).toBe('42501');
      expect(error.message).toMatch(/contexto de actor ausente/);
    } finally {
      await api.query('ROLLBACK');
    }
  });
});

describe('OperacionPlataforma escribe en auditoria', () => {
  it('con un actor de texto: fila de origen plataforma con actor_sistema, la empresa y la hora del reloj; y todo queda a su nombre', async () => {
    const actor = textoUnico('cli:prueba');
    const datos = datosDeEmpresa();
    const { empresaId, sucursales } = await ctx.app
      .get(PlataformaEmpresasService)
      .registrarEmpresa(datos, { actor, motivo: 'Alta de prueba' });
    const [fila] = await filas("accion = 'registrar_empresa' AND actor_sistema = $1", [actor]);
    expect(fila).toMatchObject({
      origen: 'plataforma',
      empresa_id: empresaId,
      motivo: 'Alta de prueba',
      actor_usuario_id: null,
      actor_superadministrador_id: null,
    });
    expect((fila.ocurrido_en as Date).getTime()).toBe(ctx.reloj.ahora().getTime());
    for (const [tabla, id] of [
      ['empresa', empresaId],
      ['sucursal', sucursales[0]!.id],
    ] as const) {
      const f = (await admin.query(`SELECT * FROM ${tabla} WHERE id = $1`, [id])).rows[0];
      expect(f, tabla).toMatchObject({ creado_por_sistema: actor, actualizado_por_sistema: actor });
    }
  });

  it('con { superadministradorId }: la fila y las escrituras llevan al superadministrador', async () => {
    const superadmin = await insertarSuperadministrador(plataformaCliente);
    const datos = datosDeEmpresa();
    const { empresaId, emisores } = await ctx.app
      .get(PlataformaEmpresasService)
      .registrarEmpresa(datos, {
        actor: { superadministradorId: superadmin },
        motivo: 'Alta HTTP',
      });
    const [fila] = await filas("accion = 'registrar_empresa' AND empresa_id = $1", [empresaId]);
    expect(fila).toMatchObject({
      actor_superadministrador_id: superadmin,
      actor_usuario_id: null,
      actor_sistema: null,
    });
    const emisor = (await admin.query('SELECT * FROM emisor WHERE id = $1', [emisores[0]!.id]))
      .rows[0];
    expect(emisor).toMatchObject({
      creado_por_superadministrador_id: superadmin,
      creado_por_sistema: null,
    });
  });

  it('todo o nada: si fn falla no queda ni el cambio ni la fila de auditoría', async () => {
    const actor = textoUnico('cli:falla');
    const operacion = ctx.app.get(OperacionPlataforma);
    await expect(
      operacion.ejecutar({ actor, motivo: 'Falla', operacion: 'prueba_falla' }, async () => {
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    expect(await filas('actor_sistema = $1', [actor])).toEqual([]);
  });

  it('valida el actor: texto de 1 a 100 caracteres o { superadministradorId } con un UUID', async () => {
    const operacion = ctx.app.get(OperacionPlataforma);
    for (const actor of [
      'x'.repeat(101),
      '   ',
      { superadministradorId: 'no-es-uuid' },
      { superadministradorId: randomUUID(), otro: 1 },
      {},
    ]) {
      await expect(
        operacion.ejecutar(
          { actor: actor as string, motivo: 'm', operacion: 'prueba' },
          async () => undefined,
        ),
        JSON.stringify(actor),
      ).rejects.toMatchObject({ codigo: 'DATOS_INVALIDOS' });
    }
  });

  it('un superadministrador inexistente como actor hace fallar la operación por la llave foránea', async () => {
    const operacion = ctx.app.get(OperacionPlataforma);
    const datos = datosDeEmpresa();
    await expect(
      ctx.app
        .get(PlataformaEmpresasService)
        .registrarEmpresa(datos, { actor: { superadministradorId: randomUUID() }, motivo: 'm' }),
    ).rejects.toThrow();
    expect(operacion).toBeDefined();
    expect(
      (await admin.query('SELECT 1 FROM emisor WHERE ruc = $1', [datos.emisores[0]!.ruc])).rows,
    ).toEqual([]);
  });

  it('insertarAuditoriaPlataforma exige una acción y deja el detalle como JSON', async () => {
    const actor = textoUnico('cli:directa');
    const operacion = ctx.app.get(OperacionPlataforma);
    await expect(
      operacion.ejecutar({ actor, motivo: 'Directa', operacion: 'prueba_directa' }, (tx) =>
        insertarAuditoriaPlataforma(tx, { accion: '', ocurridoEn: new Date() }),
      ),
    ).rejects.toThrow(/acción/);
    await operacion.ejecutar(
      { actor, motivo: 'Directa', operacion: 'prueba_directa' },
      async (tx) => {
        operacion.registrarDatosDeAuditoria(tx, { detalle: { a: [1, 2], b: 'ñ' } });
      },
    );
    const resultado = await filas('actor_sistema = $1', [actor]);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]!.detalle).toEqual({ a: [1, 2], b: 'ñ' });
  });
});
