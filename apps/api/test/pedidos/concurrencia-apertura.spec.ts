// Historia 004 · salón y cocina, grupo C2 · aperturas simultáneas (criterios 11 y 12): pruebas del desarrollador
// (no protegidas). La API corre con un pool de 2 conexiones: las peticiones esperan su turno y nunca se traban.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  abrirOrden,
  arrancarP3,
  asentar,
  crearEscenarioP3,
  exigirEstado,
  filasDe,
  sesiones,
  type AppP3,
  type EscenarioP3,
} from '../salon-critica/fabrica-p3';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppP3;
let e: EscenarioP3;
let admin: Client;
let mesas: PoolDeMesas;
let mozo: string;
let mozo2: string;
let cajero: string;

beforeAll(async () => {
  ctx = await arrancarP3({ poolMax: 2 });
  admin = await abrirCliente('admin');
  e = await crearEscenarioP3(ctx);
  mesas = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1);
  mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
  mozo2 = (await sesiones(ctx, e.mozo2, e.A.S1)).contrasena;
  cajero = (await sesiones(ctx, e.A.cajero, e.A.S1)).contrasena;
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const relaciones = (mesaId: string) =>
  filasDe(admin, 'orden_mesa', 'mesa_id = $1 AND hasta IS NULL', [mesaId]);

describe('criterio 11 · aperturas simultáneas de la misma mesa', () => {
  it('con ids distintos, exactamente una responde 201 y las demás 409 MESA_OCUPADA con la orden ganadora; nunca dos órdenes abiertas', async () => {
    const mesa = await mesas.siguiente();
    const tokens = [mozo, mozo2, cajero];
    const ids = Array.from({ length: 12 }, () => randomUUID());
    await asentar();
    ctx.publicador.limpiar();
    const respuestas = await Promise.all(
      ids.map((id, i) => abrirOrden(ctx, tokens[i % tokens.length]!, { id, mesaId: mesa.id })),
    );
    const creadas = respuestas.filter((r) => r.status === 201);
    const ocupadas = respuestas.filter((r) => r.status === 409);
    expect(creadas, JSON.stringify(respuestas.map((r) => r.status))).toHaveLength(1);
    expect(ocupadas).toHaveLength(ids.length - 1);
    const ganadora = creadas[0]!.body.id as string;
    for (const r of ocupadas) {
      expect(r.body.codigo).toBe('MESA_OCUPADA');
      expect(r.body.ordenId).toBe(ganadora);
    }
    const vigentes = await relaciones(mesa.id);
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0]!.orden_id).toBe(ganadora);
    // Solo la ganadora dejó una orden; las demás se revirtieron enteras.
    for (const id of ids.filter((x) => x !== ganadora)) {
      expect(await filasDe(admin, 'orden', 'id = $1', [id])).toHaveLength(0);
    }
    await asentar();
    expect(ctx.publicador.eventos().map((x) => x.nombre)).toEqual(['salon.cambio', 'orden.cambio']);
  });

  it('mesas distintas a la vez no se esperan entre sí: todas responden 201', async () => {
    const lista = await Promise.all(Array.from({ length: 8 }, () => mesas.siguiente()));
    const respuestas = await Promise.all(
      lista.map((m, i) => abrirOrden(ctx, i % 2 === 0 ? mozo : cajero, { mesaId: m.id })),
    );
    for (const r of respuestas) exigirEstado(r, 201, 'apertura simultánea de otra mesa');
    for (const m of lista) expect(await relaciones(m.id)).toHaveLength(1);
  });
});

describe('criterio 12 · réplicas simultáneas de la apertura', () => {
  it('diez peticiones con el mismo id y claves distintas dejan una orden y responden 201 con la misma orden', async () => {
    const mesa = await mesas.siguiente();
    const id = randomUUID();
    await asentar();
    ctx.publicador.limpiar();
    const tokens = [mozo, mozo2, cajero];
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        abrirOrden(ctx, tokens[i % tokens.length]!, { id, mesaId: mesa.id }),
      ),
    );
    for (const r of respuestas) {
      exigirEstado(r, 201, 'réplica simultánea');
      expect(r.body.id).toBe(id);
      expect(r.body.mozo.id).toBeTruthy();
    }
    // La orden es de quien ganó; todas dicen lo mismo.
    expect(new Set(respuestas.map((r) => r.body.mozo.id)).size).toBe(1);
    expect(await filasDe(admin, 'orden', 'id = $1', [id])).toHaveLength(1);
    expect(await relaciones(mesa.id)).toHaveLength(1);
    await asentar();
    expect(ctx.publicador.eventos().map((x) => x.nombre)).toEqual(['salon.cambio', 'orden.cambio']);
  });

  it('diez peticiones con el mismo id y la misma clave responden 201 con el mismo cuerpo', async () => {
    const mesa = await mesas.siguiente();
    const id = randomUUID();
    const clave = randomUUID();
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () => abrirOrden(ctx, mozo, { id, mesaId: mesa.id }, { clave })),
    );
    for (const r of respuestas) exigirEstado(r, 201, 'réplica con la misma clave');
    for (const r of respuestas) expect(r.body).toEqual(respuestas[0]!.body);
    expect(await filasDe(admin, 'orden', 'id = $1', [id])).toHaveLength(1);
  });

  it('el mismo id con mesas distintas a la vez: una orden, y las que no coinciden responden 422 o 409 sin crear otra', async () => {
    const [a, b] = await Promise.all([mesas.siguiente(), mesas.siguiente()]);
    const id = randomUUID();
    const respuestas = await Promise.all(
      [a, b, a, b].map((m) => abrirOrden(ctx, mozo, { id, mesaId: m.id })),
    );
    const creadas = respuestas.filter((r) => r.status === 201);
    expect(creadas.length).toBeGreaterThanOrEqual(1);
    expect(new Set(creadas.map((r) => r.body.mesas[0].id)).size).toBe(1);
    for (const r of respuestas.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(422);
      expect(r.body.codigo).toBe('CLAVE_IDEMPOTENCIA_REUTILIZADA');
    }
    expect(await filasDe(admin, 'orden', 'id = $1', [id])).toHaveLength(1);
    expect((await relaciones(a.id)).length + (await relaciones(b.id)).length).toBe(1);
  });
});
