import { createConnection } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BytesEscPos, EmuladorEscPos } from './index';

// Historia 004, T36: el emulador de impresora ESC/POS por TCP (criterio 135). No es una prueba protegida.

/** Abre una conexión, manda los bytes (en trozos si se pide) y espera a que el emulador cierre la suya. */
function imprimir(
  emulador: EmuladorEscPos,
  bytes: Uint8Array,
  opciones: { trozo?: number; cerrar?: boolean } = {},
): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    const socket = createConnection({ host: emulador.host, port: emulador.puerto });
    socket.once('error', rechazar);
    socket.once('close', () => resolver());
    socket.once('connect', async () => {
      const trozo = opciones.trozo ?? bytes.length;
      for (let i = 0; i < bytes.length; i += trozo) {
        socket.write(bytes.subarray(i, i + trozo));
        await new Promise((r) => setTimeout(r, 2));
      }
      if (opciones.cerrar === false) socket.destroy();
      else socket.end();
    });
  });
}

function conectar(host: string, puerto: number): Promise<'conectada' | 'rechazada'> {
  return new Promise((resolver) => {
    const socket = createConnection({ host, port: puerto });
    socket.once('connect', () => {
      socket.destroy();
      resolver('conectada');
    });
    socket.once('error', () => resolver('rechazada'));
  });
}

describe('EmuladorEscPos', () => {
  let emulador: EmuladorEscPos | undefined;
  afterEach(async () => {
    await emulador?.cerrar();
    emulador = undefined;
  });

  it('escucha en un puerto libre y entrega el ticket decodificado con sus marcas', async () => {
    emulador = await EmuladorEscPos.iniciar();
    expect(emulador.puerto).toBeGreaterThan(0);
    expect(emulador.encendido).toBe(true);
    const bytes = new BytesEscPos()
      .inicio()
      .paginaDeCodigos('PC850')
      .negrita(true)
      .tamano(1, 2)
      .linea('COCINA · COMANDA')
      .tamano(1, 1)
      .negrita(false)
      .linea('Ají de gallina')
      .avanzar(4)
      .cortar()
      .aBytes();
    await imprimir(emulador, bytes);
    const ticket = await emulador.esperarTicket();
    expect(ticket.numero).toBe(1);
    expect(ticket.completo).toBe(true);
    expect(ticket.texto).toBe('COCINA · COMANDA\nAjí de gallina');
    expect(ticket.marcado.split('\n')).toEqual([
      '[INICIO]',
      '[PAGINA PC850]',
      '[B][H2]COCINA · COMANDA',
      'Ají de gallina',
      '[AVANCE 4]',
      '[CORTE PARCIAL]',
    ]);
    expect(ticket.codificacion).toBe('PC850');
    expect(Array.from(ticket.bytes)).toEqual(Array.from(bytes));
    expect(emulador.tickets).toHaveLength(1);
    expect(emulador.bytesRecibidos).toBe(bytes.length);
  });

  it('ordena los tickets de varias conexiones y de una misma conexión', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await imprimir(emulador, BytesEscPos.ticket(['uno']));
    await imprimir(
      emulador,
      new Uint8Array([...BytesEscPos.ticket(['dos']), ...BytesEscPos.ticket(['tres'])]),
    );
    const tickets = await emulador.esperarTickets(3);
    expect(tickets.map((t) => t.texto)).toEqual(['uno', 'dos', 'tres']);
    expect(tickets.map((t) => t.numero)).toEqual([1, 2, 3]);
    expect(emulador.conexiones).toBe(2);
  });

  it('procesa un ticket que llega en trozos de un byte', async () => {
    emulador = await EmuladorEscPos.iniciar({ anchoMm: 58 });
    await imprimir(emulador, BytesEscPos.ticket(['Ñoquis', '¿Sin ají?']), { trozo: 1 });
    const ticket = await emulador.esperarTicket();
    expect(ticket.texto).toBe('Ñoquis\n¿Sin ají?');
    expect(ticket.comandosDesconocidos).toEqual([]);
  });

  it('esperarTicket consume en orden, espera a los que faltan y falla si no llegan', async () => {
    emulador = await EmuladorEscPos.iniciar();
    const esperando = emulador.esperarTicket(2000);
    await imprimir(emulador, BytesEscPos.ticket(['primero']));
    expect((await esperando).texto).toBe('primero');
    await imprimir(emulador, BytesEscPos.ticket(['segundo']));
    expect((await emulador.esperarTicket()).texto).toBe('segundo');
    await expect(emulador.esperarTicket(50)).rejects.toThrow(/0 de 1 tickets/);
    // Sigue en la lista aunque ya se consumió.
    expect(emulador.tickets.map((t) => t.texto)).toEqual(['primero', 'segundo']);
  });

  it('noRecibe pasa si no llega nada y falla si hay un ticket sin consumir', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await emulador.noRecibe(30);
    await imprimir(emulador, BytesEscPos.ticket(['de más']));
    await expect(emulador.noRecibe(30)).rejects.toThrow(/de más/);
    await emulador.esperarTicket();
    await emulador.noRecibe(30);
  });

  it('limpiar olvida los tickets', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await imprimir(emulador, BytesEscPos.ticket(['x']));
    emulador.limpiar();
    expect(emulador.tickets).toEqual([]);
    await emulador.noRecibe(30);
  });

  it('un ticket sin corte queda como parcial y no cuenta entre los tickets', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await imprimir(emulador, new BytesEscPos().inicio().linea('a medias').aBytes());
    await new Promise((r) => setTimeout(r, 30));
    expect(emulador.tickets).toEqual([]);
    expect(emulador.parciales).toHaveLength(1);
    expect(emulador.parciales[0]).toMatchObject({ completo: false, texto: 'a medias' });
  });

  it('una conexión que se corta de golpe también deja el parcial', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await imprimir(emulador, new BytesEscPos().inicio().linea('se cortó').aBytes(), {
      cerrar: false,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(emulador.parciales.map((p) => p.texto)).toEqual(['se cortó']);
  });

  it('una sonda de conexión sin datos no deja ni tickets ni parciales, pero cuenta como conexión', async () => {
    emulador = await EmuladorEscPos.iniciar();
    expect(await conectar(emulador.host, emulador.puerto)).toBe('conectada');
    await new Promise((r) => setTimeout(r, 30));
    expect(emulador.tickets).toEqual([]);
    expect(emulador.parciales).toEqual([]);
    expect(emulador.conexiones).toBe(1);
  });

  it('el ancho del papel define las columnas y cuenta las líneas partidas', async () => {
    emulador = await EmuladorEscPos.iniciar({ anchoMm: 58 });
    expect(emulador.columnas).toBe(32);
    await imprimir(emulador, BytesEscPos.ticket(['x'.repeat(40)]));
    const ticket = await emulador.esperarTicket();
    expect(ticket.lineas.map((l) => l.texto.length)).toEqual([32, 8]);
    expect(ticket.desbordes).toBe(1);
    await emulador.cerrar();
    emulador = await EmuladorEscPos.iniciar({ anchoMm: 80 });
    expect(emulador.columnas).toBe(48);
    await imprimir(emulador, BytesEscPos.ticket(['x'.repeat(48)]));
    expect((await emulador.esperarTicket()).desbordes).toBe(0);
  });

  it('anota los comandos que no entiende', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await imprimir(
      emulador,
      new BytesEscPos().inicio().crudo(0x1b, 0x58).linea('x').cortar().aBytes(),
    );
    const ticket = await emulador.esperarTicket();
    expect(ticket.comandosDesconocidos).toEqual(['1B 58']);
  });

  it('el pulso de la gaveta queda anotado en el ticket', async () => {
    emulador = await EmuladorEscPos.iniciar();
    await imprimir(emulador, new BytesEscPos().inicio().linea('x').gaveta().cortar().aBytes());
    expect((await emulador.esperarTicket()).pulsosGaveta).toBe(1);
  });

  describe('apagar y prender', () => {
    it('apagada rechaza las conexiones, conserva los tickets y vuelve en el mismo puerto', async () => {
      emulador = await EmuladorEscPos.iniciar();
      const puerto = emulador.puerto;
      await imprimir(emulador, BytesEscPos.ticket(['antes']));
      await emulador.apagar();
      expect(emulador.encendido).toBe(false);
      expect(await conectar(emulador.host, puerto)).toBe('rechazada');
      expect(emulador.tickets.map((t) => t.texto)).toEqual(['antes']);
      await emulador.prender();
      expect(emulador.encendido).toBe(true);
      expect(emulador.puerto).toBe(puerto);
      await imprimir(emulador, BytesEscPos.ticket(['después']));
      expect((await emulador.esperarTickets(2)).map((t) => t.texto)).toEqual(['antes', 'después']);
    });

    it('apagar y prender dos veces seguidas no falla', async () => {
      emulador = await EmuladorEscPos.iniciar();
      await emulador.apagar();
      await emulador.apagar();
      await emulador.prender();
      await emulador.prender();
      expect(await conectar(emulador.host, emulador.puerto)).toBe('conectada');
    });

    it('colgada acepta la conexión pero no procesa nada hasta que se prende', async () => {
      emulador = await EmuladorEscPos.iniciar();
      await emulador.apagar('colgar');
      expect(emulador.encendido).toBe(false);
      expect(await conectar(emulador.host, emulador.puerto)).toBe('conectada');
      let cerro = false;
      const pendiente = imprimir(emulador, BytesEscPos.ticket(['en espera'])).then(() => {
        cerro = true;
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(cerro).toBe(false);
      expect(emulador.tickets).toEqual([]);
      await emulador.prender();
      await pendiente;
      expect((await emulador.esperarTicket()).texto).toBe('en espera');
    });

    it('cerrar suelta una impresora colgada con conexiones abiertas', async () => {
      emulador = await EmuladorEscPos.iniciar();
      await emulador.apagar('colgar');
      const socket = createConnection({ host: emulador.host, port: emulador.puerto });
      await new Promise((r) => socket.once('connect', r));
      await emulador.cerrar();
      await new Promise((r) => socket.once('close', r));
      expect(await conectar(emulador.host, emulador.puerto)).toBe('rechazada');
    });
  });
});
