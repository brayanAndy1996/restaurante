import { createServer } from 'node:http';
import type { ParteDeStock } from '@restaurante/dominio';
import { Server } from 'socket.io';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import { InventarioNulo } from '../../src/modulos/pedidos/inventario';
import { ClienteTiempoReal, InventarioDePrueba } from './index';

// Infraestructura de pruebas de la historia 004 (T3): el puerto de inventario de prueba y el cliente de
// Socket.IO. No es una prueba protegida.

const SUCURSAL = '11111111-1111-1111-1111-111111111111';
const ENVIO = '22222222-2222-2222-2222-222222222222';
const PARTES: ParteDeStock[] = [
  {
    productoId: '33333333-3333-3333-3333-333333333333',
    nombre: 'Huevo frito',
    cantidad: 2,
    tipoControlStock: 'UNIDADES',
  },
];

describe('InventarioNulo', () => {
  it('no hace nada y no tiene datos de stock', async () => {
    const nulo = new InventarioNulo();
    await expect(
      nulo.alEnviar({ sucursalId: SUCURSAL, envioId: ENVIO, partes: PARTES }),
    ).resolves.toBeUndefined();
    await expect(
      nulo.alAnular({ sucursalId: SUCURSAL, anulacionId: ENVIO, partes: PARTES, destino: 'MERMA' }),
    ).resolves.toBeUndefined();
    expect((await nulo.disponibles({ sucursalId: SUCURSAL, productoIds: [ENVIO] })).size).toBe(0);
  });
});

describe('InventarioDePrueba', () => {
  it('registra las llamadas en orden, como copias que no cambian después', async () => {
    const inventario = new InventarioDePrueba();
    const partes: ParteDeStock[] = structuredClone(PARTES);
    await inventario.alEnviar({ sucursalId: SUCURSAL, envioId: ENVIO, partes });
    partes[0]!.cantidad = 99;
    await inventario.alAnular({
      sucursalId: SUCURSAL,
      anulacionId: ENVIO,
      partes: PARTES,
      destino: 'VUELVE',
    });
    expect(inventario.llamadas().map((l) => l.metodo)).toEqual(['alEnviar', 'alAnular']);
    expect(inventario.alEnviarLlamadas()[0]?.partes[0]?.cantidad).toBe(2);
    expect(inventario.alAnularLlamadas()[0]?.destino).toBe('VUELVE');
    inventario.limpiar();
    expect(inventario.llamadas()).toEqual([]);
  });

  it('puede lanzar un error en alEnviar y en alAnular, y registra igual la llamada', async () => {
    const inventario = new InventarioDePrueba();
    const error = new ErrorAplicacion(422, 'CONFLICTO', 'Sin stock');
    inventario.lanzarAlEnviar(error);
    await expect(
      inventario.alEnviar({ sucursalId: SUCURSAL, envioId: ENVIO, partes: PARTES }),
    ).rejects.toBe(error);
    expect(inventario.alEnviarLlamadas()).toHaveLength(1);
    inventario.lanzarAlEnviar(null);
    await expect(
      inventario.alEnviar({ sucursalId: SUCURSAL, envioId: ENVIO, partes: PARTES }),
    ).resolves.toBeUndefined();
    inventario.lanzarAlAnular(error);
    await expect(
      inventario.alAnular({
        sucursalId: SUCURSAL,
        anulacionId: ENVIO,
        partes: PARTES,
        destino: 'MERMA',
      }),
    ).rejects.toBe(error);
  });

  it('disponibles devuelve solo lo configurado de los productos pedidos', async () => {
    const inventario = new InventarioDePrueba();
    inventario.fijarDisponibles(
      new Map([
        [ENVIO, 7],
        [SUCURSAL, 3],
      ]),
    );
    const respuesta = await inventario.disponibles({
      sucursalId: SUCURSAL,
      productoIds: [ENVIO, '44444444-4444-4444-4444-444444444444'],
    });
    expect([...respuesta]).toEqual([[ENVIO, 7]]);
  });
});

describe('ClienteTiempoReal', () => {
  const cierres: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cerrar of cierres.splice(0)) await cerrar();
  });

  /** Un servidor de Socket.IO propio (sin la API) que acepta a quien llegue con `auth.token === 'bueno'`. */
  async function levantarServidor(): Promise<{
    io: Server;
    app: { getHttpServer: () => ReturnType<typeof createServer> };
  }> {
    const http = createServer();
    const io = new Server(http, { path: '/tiempo-real', serveClient: false });
    io.use((socket, siguiente) =>
      (socket.handshake.auth as { token?: string }).token === 'bueno'
        ? siguiente()
        : siguiente(new Error('NO_AUTENTICADO')),
    );
    await new Promise<void>((resolver) => http.listen(0, '127.0.0.1', resolver));
    cierres.push(async () => {
      await io.close();
    });
    return { io, app: { getHttpServer: () => http } };
  }

  const comoApp = (servidor: { getHttpServer: () => ReturnType<typeof createServer> }) =>
    servidor as unknown as Parameters<typeof ClienteTiempoReal.conectar>[0];

  it('conecta, y un rechazo del servidor sale como error con su mensaje', async () => {
    const servidor = await levantarServidor();
    const rechazado = await ClienteTiempoReal.intentarConectar(comoApp(servidor.app), {
      token: 'malo',
    });
    expect(rechazado).toEqual({ cliente: null, error: 'NO_AUTENTICADO' });
    await expect(ClienteTiempoReal.conectar(comoApp(servidor.app), {})).rejects.toThrow(
      'NO_AUTENTICADO',
    );
    const cliente = await ClienteTiempoReal.conectar(comoApp(servidor.app), { token: 'bueno' });
    cierres.push(async () => cliente.cerrar());
    expect(cliente.conectado).toBe(true);
  });

  it('esperarEvento entrega el evento aunque haya llegado antes de pedirlo, y una sola vez', async () => {
    const servidor = await levantarServidor();
    servidor.io.on('connection', (socket) => socket.emit('salon.cambio', { ordenId: 'a' }));
    const cliente = await ClienteTiempoReal.conectar(comoApp(servidor.app), { token: 'bueno' });
    cierres.push(async () => cliente.cerrar());
    await new Promise((resolver) => setTimeout(resolver, 100));
    expect(cliente.eventos('salon.cambio')).toHaveLength(1);
    await expect(cliente.esperarEvento('salon.cambio', 500)).resolves.toEqual({ ordenId: 'a' });
    await expect(cliente.esperarEvento('salon.cambio', 100)).rejects.toThrow('No llegó el evento');
  });

  it('esperarEvento espera al que llega después', async () => {
    const servidor = await levantarServidor();
    const cliente = await ClienteTiempoReal.conectar(comoApp(servidor.app), { token: 'bueno' });
    cierres.push(async () => cliente.cerrar());
    const espera = cliente.esperarEvento<{ n: number }>('orden.cambio', 1000);
    servidor.io.emit('orden.cambio', { n: 1 });
    await expect(espera).resolves.toEqual({ n: 1 });
  });

  it('noRecibe pasa si no llega nada y falla si llega o ya había llegado', async () => {
    const servidor = await levantarServidor();
    const cliente = await ClienteTiempoReal.conectar(comoApp(servidor.app), { token: 'bueno' });
    cierres.push(async () => cliente.cerrar());
    await expect(cliente.noRecibe('cocina.comanda', 100)).resolves.toBeUndefined();
    servidor.io.emit('cocina.comanda', {});
    await expect(cliente.noRecibe('cocina.comanda', 200)).rejects.toThrow('que no debía llegar');
    await expect(cliente.noRecibe('otro.evento', 50)).resolves.toBeUndefined();
  });

  it('emitir no cambia nada en el servidor y esperarDesconexion ve el cierre del servidor', async () => {
    const servidor = await levantarServidor();
    const cliente = await ClienteTiempoReal.conectar(comoApp(servidor.app), { token: 'bueno' });
    cierres.push(async () => cliente.cerrar());
    cliente.emitir('join', 'e:otra-empresa');
    await expect(cliente.noRecibe('respuesta', 50)).resolves.toBeUndefined();
    expect(cliente.conectado).toBe(true);
    servidor.io.disconnectSockets(true);
    await expect(cliente.esperarDesconexion(1000)).resolves.toBe('io server disconnect');
    expect(cliente.conectado).toBe(false);
  });

  it('urlDe falla con un mensaje claro si la aplicación no escucha un puerto', () => {
    const sinPuerto = { getHttpServer: () => createServer() };
    expect(() => ClienteTiempoReal.urlDe(comoApp(sinPuerto))).toThrow('no escucha un puerto');
  });
});
