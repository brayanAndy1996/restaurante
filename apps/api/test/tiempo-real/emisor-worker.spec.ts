import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANAL_DEL_ESPACIO_PWA,
  PoolDelAdaptador,
} from '../../src/nucleo/tiempo-real/adaptador-postgres';
import { EmisorDelWorker, salaDeSucursal } from '../../src/nucleo/tiempo-real';
import { urlDeRol } from '../utilidades';

// Prueba del desarrollador (no protegida) del emisor de eventos del worker (historia 006, criterio 172): un evento del
// worker llega, por el canal de PostgreSQL, a las conexiones de la sala de su sucursal en un servidor de Socket.IO, y a
// ninguna de otra sucursal ni de otra empresa.

const EMPRESA = '11111111-1111-1111-1111-111111111111';
const OTRA_EMPRESA = '22222222-2222-2222-2222-222222222222';
const SUCURSAL = '33333333-3333-3333-3333-333333333333';
const COMPROBANTE = '44444444-4444-4444-4444-444444444444';

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function hasta(condicion: () => boolean, ms: number): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicion()) return;
    await pausa(25);
  }
  throw new Error(`La condición no se cumplió en ${ms} ms`);
}

describe('EmisorDelWorker', () => {
  const sockets: Socket[] = [];
  const servidores: Server[] = [];
  const pools: PoolDelAdaptador[] = [];
  const emisores: EmisorDelWorker[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    for (const s of servidores.splice(0)) await s.close();
    for (const p of pools.splice(0)) await p.cerrar();
    for (const e of emisores.splice(0)) await e.cerrar();
  });

  it('un evento del worker llega a la sala de su sucursal y a ninguna otra', async () => {
    const adaptador = new PoolDelAdaptador(urlDeRol('tiempoReal'));
    pools.push(adaptador);
    const servidor = new Server({ adapter: adaptador.crearAdaptador() });
    servidores.push(servidor);
    servidor.on('connection', (socket) => {
      const sucursal = socket.handshake.auth.sucursal as string;
      const empresa = socket.handshake.auth.empresa as string;
      void socket.join(salaDeSucursal(empresa, sucursal));
    });
    servidor.listen(0);
    await adaptador.esperarEscucha(CANAL_DEL_ESPACIO_PWA);
    const puerto = (servidor.httpServer.address() as AddressInfo).port;

    const conectarCon = async (auth: { empresa: string; sucursal: string }) => {
      const socket = conectar(`http://127.0.0.1:${puerto}`, { reconnection: false, auth });
      sockets.push(socket);
      const recibidos: unknown[] = [];
      socket.on('comprobante.estado', (datos: unknown) => recibidos.push(datos));
      await new Promise<void>((resolver) => socket.on('connect', resolver));
      return recibidos;
    };
    const deLaSucursal = await conectarCon({ empresa: EMPRESA, sucursal: SUCURSAL });
    const deOtraSucursal = await conectarCon({
      empresa: EMPRESA,
      sucursal: '55555555-5555-5555-5555-555555555555',
    });
    const deOtraEmpresa = await conectarCon({ empresa: OTRA_EMPRESA, sucursal: SUCURSAL });

    const emisor = new EmisorDelWorker(urlDeRol('tiempoReal'));
    emisores.push(emisor);
    await emisor.verificar();
    const datos = { comprobanteId: COMPROBANTE, estado: 'ACEPTADO', sucursalId: SUCURSAL };
    await emisor.publicar({
      empresaId: EMPRESA,
      sala: { tipo: 'sucursal', sucursalId: SUCURSAL },
      nombre: 'comprobante.estado',
      datos,
    });
    await hasta(() => deLaSucursal.length === 1, 3_000);
    await pausa(300);
    expect(deLaSucursal).toEqual([datos]);
    expect(deOtraSucursal).toEqual([]);
    expect(deOtraEmpresa).toEqual([]);
  });

  it('descarta un evento con ids inválidos o demasiado pesado sin lanzar', async () => {
    const emisor = new EmisorDelWorker(urlDeRol('tiempoReal'));
    emisores.push(emisor);
    await expect(
      emisor.publicar({
        empresaId: 'no-es-un-uuid',
        sala: { tipo: 'sucursal', sucursalId: SUCURSAL },
        nombre: 'comprobante.estado',
        datos: {},
      }),
    ).resolves.toBeUndefined();
    await expect(
      emisor.publicar({
        empresaId: EMPRESA,
        sala: { tipo: 'sucursal', sucursalId: SUCURSAL },
        nombre: 'comprobante.estado',
        datos: { relleno: 'x'.repeat(5000) },
      }),
    ).resolves.toBeUndefined();
  });
});
