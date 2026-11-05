import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as conectar, type Socket } from 'socket.io-client';
import type { Client, PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CANAL_DEL_ESPACIO_PWA,
  PoolDelAdaptador,
} from '../../src/nucleo/tiempo-real/adaptador-postgres';
import { abrirCliente, urlDeRol } from '../utilidades';

// Historia 006 (regresión del ticket de Cocina): una caída de la conexión del adaptador de Socket.IO (reinicio o
// failover de PostgreSQL) no puede dejar el pool sin cupo para publicar. Sin esto, `pg_notify` fallaba para siempre
// con «timeout exceeded when trying to connect» y el aviso `trabajo.nuevo` no llegaba al puente: la comanda salía
// recién con su sondeo (~5 s) en lugar de al instante. No es una prueba protegida.

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

async function hasta(condicion: () => boolean | Promise<boolean>, ms: number): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await esperar(25);
  }
  throw new Error(`La condición no se cumplió en ${ms} ms`);
}

describe('el pool del adaptador de tiempo real se recupera de una caída de la base', () => {
  let admin: Client;
  const pools: PoolDelAdaptador[] = [];
  const servidores: Server[] = [];
  const sockets: Socket[] = [];

  /** Un pool del adaptador que recuerda el pid de cada conexión que abre. */
  function crearPool(): { adaptador: PoolDelAdaptador; pids: number[] } {
    const adaptador = new PoolDelAdaptador(urlDeRol('tiempoReal'));
    const pids: number[] = [];
    adaptador.pool.on('connect', (cliente: PoolClient) => {
      pids.push((cliente as unknown as { processID: number }).processID);
    });
    pools.push(adaptador);
    return { adaptador, pids };
  }

  const matar = async (pids: readonly number[]) => {
    for (const pid of pids) await admin.query('SELECT pg_terminate_backend($1)', [pid]);
  };

  beforeEach(async () => {
    admin = await abrirCliente('admin');
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    for (const servidor of servidores.splice(0)) await servidor.close();
    for (const adaptador of pools.splice(0)) await adaptador.cerrar();
    await admin.end();
  });

  it('la conexión que escuchaba y se cayó deja de ocupar un cupo del pool', async () => {
    const { adaptador, pids } = crearPool();
    // El adaptador toma una conexión y no la devuelve mientras escucha: se imita igual.
    const oyente = await adaptador.pool.connect();
    oyente.on('end', () => undefined);
    await oyente.query(`LISTEN "${CANAL_DEL_ESPACIO_PWA}"`);
    expect(adaptador.pool.totalCount).toBe(1);

    await matar(pids);
    await hasta(() => adaptador.pool.totalCount === 0, 2_000);

    // El oyente nuevo que toma el adaptador al reconectar no deja al pool sin cupo para publicar (`pg_notify`).
    const nuevo = await adaptador.pool.connect();
    try {
      const { rows } = await adaptador.pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      nuevo.release();
    }
  });

  it('un evento publicado después de que cae la base llega a los clientes de otra instancia', async () => {
    const a = crearPool();
    const b = crearPool();
    const servidorA = new Server({ adapter: a.adaptador.crearAdaptador() });
    const servidorB = new Server({ adapter: b.adaptador.crearAdaptador() });
    servidores.push(servidorA, servidorB);
    servidorB.on('connection', (socket) => void socket.join('puente'));
    servidorA.listen(0); // sin servidor HTTP `close()` no tiene qué cerrar
    servidorB.listen(0);
    await Promise.all([
      a.adaptador.esperarEscucha(CANAL_DEL_ESPACIO_PWA),
      b.adaptador.esperarEscucha(CANAL_DEL_ESPACIO_PWA),
    ]);

    const direccion = servidorB.httpServer.address() as AddressInfo;
    const cliente = conectar(`http://127.0.0.1:${direccion.port}`, { reconnection: false });
    sockets.push(cliente);
    const recibidos: unknown[] = [];
    cliente.on('trabajo.nuevo', (datos: unknown) => recibidos.push(datos));
    await new Promise<void>((resolver) => cliente.on('connect', resolver));

    // Antes de la caída todo anda.
    servidorA.to('puente').emit('trabajo.nuevo', { trabajoId: 'antes' });
    await hasta(() => recibidos.length === 1, 3_000);

    // Se cae toda conexión de A y de B (como un reinicio de PostgreSQL) y los adaptadores reconectan solos.
    await matar([...a.pids, ...b.pids]);
    await esperar(300); // las conexiones muertas se notan y el adaptador agenda su reconexión (≤ 3 s)
    await Promise.all([
      a.adaptador.esperarEscucha(CANAL_DEL_ESPACIO_PWA, 10_000),
      b.adaptador.esperarEscucha(CANAL_DEL_ESPACIO_PWA, 10_000),
    ]);

    servidorA.to('puente').emit('trabajo.nuevo', { trabajoId: 'despues' });
    await hasta(() => recibidos.length === 2, 3_000);
    expect(recibidos).toEqual([{ trabajoId: 'antes' }, { trabajoId: 'despues' }]);
  });
});
