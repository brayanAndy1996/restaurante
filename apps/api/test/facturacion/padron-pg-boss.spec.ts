// Prueba del desarrollador (no protegida) de la programación del padrón con pg-boss real (historia 006, T36; criterio 138):
// el trabajo `padron-ruc` se programa a las 04:00 de Lima, la carga a pedido deja a lo más una esperando y el worker la
// procesa. El trabajo no lleva datos.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ColaPgBoss, TRABAJO_PADRON_RUC } from '../../src/nucleo/colas';
import { abrirCliente } from '../utilidades';
import { urlDeRol } from '../utilidades/bd';
import {
  arrancarFact,
  cerrarAdmin,
  type AppFact,
} from '../facturacion-critica/fabrica-facturacion';
import type { Client } from 'pg';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let admin: Client;
const colasAbiertas: ColaPgBoss[] = [];

const esperarHasta = async (condicion: () => Promise<boolean>, ms = 40_000): Promise<void> => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('La condición no se cumplió a tiempo');
};
const abrirCola = (mantenimiento: boolean): ColaPgBoss => {
  const cola = new ColaPgBoss(urlDeRol('colas'), { mantenimiento });
  colasAbiertas.push(cola);
  return cola;
};
const limpiar = async (): Promise<void> => {
  await admin.query('DELETE FROM colas.job WHERE name = $1', [TRABAJO_PADRON_RUC]);
};

beforeAll(async () => {
  ctx = await arrancarFact();
  admin = await abrirCliente('admin');
});
afterAll(async () => {
  for (const cola of colasAbiertas) await cola.detener().catch(() => undefined);
  await limpiar().catch(() => undefined);
  await admin?.end();
  await ctx?.cerrar();
  await cerrarAdmin();
});

describe('la carga del padrón con pg-boss real', () => {
  it('programa la carga diaria a las 04:00 de Lima y la carga a pedido deja a lo más una esperando', async () => {
    const worker = abrirCola(true);
    const procesadas: number[] = [];
    await worker.programarPadron(() => {
      procesadas.push(Date.now());
      return Promise.resolve();
    });
    const programa = await admin.query(
      'SELECT cron, timezone FROM colas.schedule WHERE name = $1',
      [TRABAJO_PADRON_RUC],
    );
    expect(programa.rows).toEqual([{ cron: '0 4 * * *', timezone: 'America/Lima' }]);

    // Una API que solo encola: dos pedidos seguidos dejan un solo trabajo, sin datos.
    const api = abrirCola(false);
    await worker.detener();
    await limpiar();
    await api.pedirCargaDePadron();
    await api.pedirCargaDePadron();
    const trabajos = await admin.query(
      'SELECT data, policy FROM colas.job WHERE name = $1 ORDER BY created_on',
      [TRABAJO_PADRON_RUC],
    );
    expect(trabajos.rows).toHaveLength(1);
    expect(trabajos.rows[0]?.data).toEqual({});
  });

  it('el worker procesa el trabajo pedido', async () => {
    await limpiar();
    const worker = abrirCola(true);
    let cargas = 0;
    await worker.programarPadron(() => {
      cargas += 1;
      return Promise.resolve();
    });
    await worker.pedirCargaDePadron();
    await esperarHasta(() => Promise.resolve(cargas === 1));
    // Un trabajo que lanza no tumba al worker: queda en el registro y el siguiente pedido se procesa.
    const fallida = abrirCola(true);
    await worker.detener();
    await fallida.programarPadron(() => Promise.reject(new Error('falla de prueba')));
    await fallida.pedirCargaDePadron();
    await esperarHasta(async () => {
      const r = await admin.query(
        "SELECT count(*)::int AS n FROM colas.job WHERE name = $1 AND state IN ('created', 'active')",
        [TRABAJO_PADRON_RUC],
      );
      return r.rows[0]?.n === 0;
    });
  });
});
