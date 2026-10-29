// Historia 004 · salón y cocina, grupo C2 · las lecturas que otros módulos hacen sobre pedidos
// (`PedidosConsultaService`) y sobre las personas (`UsuariosConsultaService`): pruebas del desarrollador (no
// protegidas).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { PedidosConsultaService } from '../../src/modulos/pedidos';
import { UsuariosConsultaService } from '../../src/modulos/seguridad';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  abrirOrden,
  arrancarP3,
  crearEscenarioP3,
  crearPersona,
  exigirEstado,
  llamar,
  sesiones,
  type AppP3,
  type EscenarioP3,
} from '../salon-critica/fabrica-p3';
import { anularPorSql, ponerEstado } from './ayudas-pedidos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP3;
let e: EscenarioP3;
let api: Client;

beforeAll(async () => {
  ctx = await arrancarP3();
  api = await abrirCliente('api');
  e = await crearEscenarioP3(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await api?.end();
});

const enContexto = <T>(empresaId: string, fn: () => Promise<T>) =>
  ctx.app.get(ContextoEmpresa).ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });

describe('PedidosConsultaService', () => {
  it('hayOrdenesAbiertas y ordenesAbiertas ven las órdenes abiertas o en pre-cuenta de la sucursal, de la más antigua a la más nueva', async () => {
    const consulta = ctx.app.get(PedidosConsultaService);
    const pool = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S3!);
    const admin3 = (await sesiones(ctx, e.A.base.admin, e.A.S3!)).contrasena;
    expect(await enContexto(e.A.empresaId, () => consulta.hayOrdenesAbiertas(e.A.S3!))).toBe(false);
    expect(await enContexto(e.A.empresaId, () => consulta.ordenesAbiertas(e.A.S3!))).toEqual([]);

    const [m1, m2, m3] = [await pool.siguiente(), await pool.siguiente(), await pool.siguiente()];
    const o1 = await abrirOrden(ctx, admin3, { mesaId: m1.id, mozoId: e.A.base.admin.id });
    ctx.reloj.avanzar(60_000);
    const o2 = await abrirOrden(ctx, admin3, { mesaId: m2.id, mozoId: e.A.base.admin.id });
    ctx.reloj.avanzar(60_000);
    const o3 = await abrirOrden(ctx, admin3, { mesaId: m3.id, mozoId: e.A.base.admin.id });
    for (const o of [o1, o2, o3]) exigirEstado(o, 201, 'abrir');
    await ponerEstado(api, e.A.empresaId, o2.body.id as string, 'EN_PRECUENTA');
    await anularPorSql(api, e.A.empresaId, o3.body.id as string);

    expect(await enContexto(e.A.empresaId, () => consulta.hayOrdenesAbiertas(e.A.S3!))).toBe(true);
    const abiertas = await enContexto(e.A.empresaId, () => consulta.ordenesAbiertas(e.A.S3!));
    expect(abiertas.map((o) => [o.id, o.estado, o.mozoId, o.mesaIds])).toEqual([
      [o1.body.id, 'ABIERTA', e.A.base.admin.id, [m1.id]],
      [o2.body.id, 'EN_PRECUENTA', e.A.base.admin.id, [m2.id]],
    ]);
    expect(abiertas[0]!.abiertaEn).toBeInstanceOf(Date);
    // Solo las de la sucursal pedida, y nada de otra empresa.
    expect(await enContexto(e.A.empresaId, () => consulta.hayOrdenesAbiertas(randomUUID()))).toBe(
      false,
    );
    expect(await enContexto(e.B.empresaId, () => consulta.hayOrdenesAbiertas(e.A.S3!))).toBe(false);
    await anularPorSql(api, e.A.empresaId, o1.body.id as string);
    await anularPorSql(api, e.A.empresaId, o2.body.id as string);
    expect(await enContexto(e.A.empresaId, () => consulta.hayOrdenesAbiertas(e.A.S3!))).toBe(false);
  });
});

describe('UsuariosConsultaService', () => {
  it('puedenAtenderMesa deja pasar al Administrador y a quien tiene ATENDER_MESA con su rol en la sucursal; nadie más', async () => {
    const consulta = ctx.app.get(UsuariosConsultaService);
    const soloS2 = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S2, rol: 'MOZO' }]);
    const inactivo = await crearPersona(ctx, e.A.tokenAdmin, [{ sucursalId: e.A.S1, rol: 'MOZO' }]);
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/usuarios/${inactivo.id}`,
        cuerpo: { activo: false },
      }),
      200,
      'desactivar',
    );
    const candidatos = [
      e.A.mozo.id,
      e.A.cajero.id,
      e.A.supervisor.id,
      e.A.base.admin.id,
      e.A.cocina.id,
      soloS2.id,
      inactivo.id,
      e.B.mozo.id,
      randomUUID(),
    ];
    const validos = await enContexto(e.A.empresaId, () =>
      consulta.puedenAtenderMesa(
        e.A.S1,
        candidatos.map((id) => id.toUpperCase()),
      ),
    );
    expect([...validos].sort()).toEqual(
      [e.A.mozo.id, e.A.cajero.id, e.A.supervisor.id, e.A.base.admin.id].sort(),
    );
    // El rol que cuenta es el de la sucursal: el Cajero de S1 es Mozo en S2.
    const enS2 = await enContexto(e.A.empresaId, () =>
      consulta.puedenAtenderMesa(e.A.S2, [e.A.cajero.id, e.A.cocina.id, soloS2.id]),
    );
    expect([...enS2].sort()).toEqual([e.A.cajero.id, soloS2.id].sort());
    expect(await enContexto(e.A.empresaId, () => consulta.puedenAtenderMesa(e.A.S1, []))).toEqual(
      new Set(),
    );
  });

  it('nombres devuelve el nombre de los usuarios de la empresa y nada de otra empresa', async () => {
    const consulta = ctx.app.get(UsuariosConsultaService);
    const nombres = await enContexto(e.A.empresaId, () =>
      consulta.nombres([e.A.mozo.id, e.B.mozo.id, randomUUID()]),
    );
    expect([...nombres.keys()]).toEqual([e.A.mozo.id]);
    expect(nombres.get(e.A.mozo.id)).toBeTruthy();
  });
});
