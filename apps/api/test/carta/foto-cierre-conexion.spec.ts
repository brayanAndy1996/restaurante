// Historia 003 · ronda 2 adversarial, observaciones O1 y O3 (no críticas): pruebas del desarrollador (no
// protegidas) de la subida de la foto de un producto, `PUT /carta/productos/:id/foto`.
// - O1: cuando la subida se rechaza (401, 403, 413 o 415) y el cuerpo no llegó entero, la API no lo lee ni lo
//   descarta: la respuesta lleva `Connection: close`, el cliente la recibe completa y el socket se cierra enseguida,
//   aunque el cliente siga enviando. Antes la API leía todo (más de 1 GB en 2 s) hasta el `requestTimeout` de 300 s.
//   Si el cuerpo ya llegó entero no se cierra nada (la conexión sigue como siempre).
// - O3: si el cliente corta una subida autorizada a la mitad, la API la trata como una petición inválida (400
//   `PETICION_INVALIDA`) y lo registra como aviso, no como error (antes era un 500 con `logger.error`).
import { connect, type Socket } from 'node:net';
import { Logger } from '@nestjs/common';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  arrancarCarta,
  crearEscenarioCarta,
  pngValido,
  sembrarCarta,
  sesionContrasena,
  type AppCarta,
  type DatosCarta,
  type EscenarioCarta,
} from '../carta-critica/fabrica-permisos-carta';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppCarta;
let admin: Client;
let e: EscenarioCarta;
let datos: DatosCarta;
let puerto: number;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await arrancarCarta({ poolMax: 4 });
  puerto = (ctx.app.getHttpServer().address() as { port: number }).port;
  admin = await abrirCliente('admin');
  e = await crearEscenarioCarta(ctx);
  datos = await sembrarCarta(ctx, e.A.tokenAdmin);
});

afterEach(() => {
  for (const s of sockets.splice(0)) s.destroy();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));
const rutaFoto = () => `/carta/productos/${datos.productoId}/foto`;

interface Conexion {
  sock: Socket;
  /** Todo lo que el servidor escribió hasta ahora. */
  recibido: () => string;
  cerrada: () => boolean;
  /** Resuelve cuando el servidor cerró (o falló) la conexión. */
  alCerrar: Promise<void>;
}

/** Abre una conexión TCP cruda y escribe la cabecera. */
function abrir(metodoYRuta: string, cabeceras: Record<string, string | number>): Conexion {
  const sock = connect(puerto, '127.0.0.1');
  sockets.push(sock);
  sock.on('error', () => undefined);
  let texto = '';
  let cerrada = false;
  sock.on('data', (d) => (texto += d.toString('latin1')));
  const alCerrar = new Promise<void>((resolver) =>
    sock.once('close', () => {
      cerrada = true;
      resolver();
    }),
  );
  sock.write(
    `${metodoYRuta} HTTP/1.1\r\nHost: localhost\r\n` +
      Object.entries(cabeceras)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('') +
      '\r\n',
  );
  return { sock, recibido: () => texto, cerrada: () => cerrada, alCerrar };
}

const trozo = (b: Buffer) =>
  Buffer.concat([Buffer.from(`${b.length.toString(16)}\r\n`), b, Buffer.from('\r\n')]);

/** Escribe respetando la contrapresión; `false` si el socket ya se cerró. */
function escribir(sock: Socket, b: Buffer): Promise<boolean> {
  return new Promise((resolver) => {
    if (sock.destroyed) return resolver(false);
    const libre = sock.write(b, (error) => {
      if (error) resolver(false);
    });
    if (libre) resolver(true);
    else {
      sock.once('drain', () => resolver(true));
      sock.once('close', () => resolver(false));
    }
  });
}

/**
 * Sigue enviando relleno (hasta `maxBytes`) mientras el servidor no cierre. Devuelve cuánto logró enviar y si el
 * servidor cortó la conexión antes de agotarlo.
 */
async function enviarMientrasVive(
  c: Conexion,
  maxBytes: number,
  chunked: boolean,
): Promise<{ enviados: number; cortada: boolean }> {
  const relleno = Buffer.alloc(64 * 1024, 0x42);
  let enviados = 0;
  const limite = Date.now() + 15_000;
  while (enviados < maxBytes && Date.now() < limite) {
    if (c.cerrada() || !(await escribir(c.sock, chunked ? trozo(relleno) : relleno))) break;
    enviados += relleno.length;
  }
  return { enviados, cortada: c.cerrada() || c.sock.destroyed };
}

const estado = (texto: string): number => Number(/^HTTP\/1\.1 (\d{3})/.exec(texto)?.[1] ?? -1);

/** Comprueba la respuesta completa (cabecera `Connection: close` y cuerpo JSON con `codigo`) y que el socket se cierra. */
async function exigirRechazoYCierre(
  c: Conexion,
  estadoEsperado: number,
  codigo: string,
  enviar: { maxBytes: number; chunked: boolean },
): Promise<void> {
  const { enviados, cortada } = await enviarMientrasVive(c, enviar.maxBytes, enviar.chunked);
  await Promise.race([c.alCerrar, dormir(5_000)]);
  const texto = c.recibido();
  expect(estado(texto), texto.slice(0, 300)).toBe(estadoEsperado);
  expect(texto).toMatch(/connection: close/i);
  expect(texto, 'el cuerpo de la respuesta llegó entero').toContain(`"codigo":"${codigo}"`);
  expect(c.cerrada(), 'el servidor cerró la conexión').toBe(true);
  // No leyó todo lo que se le quiso mandar: el cierre llegó antes de agotar el envío.
  expect(cortada || enviados < enviar.maxBytes).toBe(true);
  expect(enviados).toBeLessThan(enviar.maxBytes);
}

describe('O1 · un rechazo de la foto con el cuerpo a medias cierra la conexión sin leerlo', () => {
  const MAX = 200 * 1024 * 1024;

  it('401: sin sesión, cuerpo chunked sin fin', async () => {
    const c = abrir(`PUT ${rutaFoto()}`, {
      'Content-Type': 'image/png',
      'Transfer-Encoding': 'chunked',
    });
    await escribir(c.sock, trozo(Buffer.alloc(1024, 1)));
    await exigirRechazoYCierre(c, 401, 'NO_AUTENTICADO', { maxBytes: MAX, chunked: true });
  });

  it('403: sin permiso, Content-Length de 500 MB', async () => {
    const supervisor = await sesionContrasena(ctx, e.A.supervisor, e.A.S1);
    const c = abrir(`PUT ${rutaFoto()}`, {
      Authorization: `Bearer ${supervisor}`,
      'Content-Type': 'image/png',
      'Content-Length': 500_000_000,
    });
    await escribir(c.sock, Buffer.alloc(1024, 1));
    await exigirRechazoYCierre(c, 403, 'PROHIBIDO', { maxBytes: MAX, chunked: false });
  });

  it('413: con permiso, pasa de 1 MB sin Content-Length', async () => {
    const c = abrir(`PUT ${rutaFoto()}`, {
      Authorization: `Bearer ${e.A.tokenAdmin}`,
      'Content-Type': 'image/png',
      'Transfer-Encoding': 'chunked',
    });
    await escribir(c.sock, trozo(Buffer.alloc(1_100_000, 1)));
    await exigirRechazoYCierre(c, 413, 'CUERPO_DEMASIADO_GRANDE', { maxBytes: MAX, chunked: true });
  });

  it('413: con permiso, Content-Length declarado de 500 MB', async () => {
    const c = abrir(`PUT ${rutaFoto()}`, {
      Authorization: `Bearer ${e.A.tokenAdmin}`,
      'Content-Type': 'image/png',
      'Content-Length': 500_000_000,
    });
    await escribir(c.sock, Buffer.alloc(1024, 1));
    await exigirRechazoYCierre(c, 413, 'CUERPO_DEMASIADO_GRANDE', {
      maxBytes: MAX,
      chunked: false,
    });
  });

  it('415: con permiso, tipo no admitido', async () => {
    const c = abrir(`PUT ${rutaFoto()}`, {
      Authorization: `Bearer ${e.A.tokenAdmin}`,
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
    });
    await escribir(c.sock, trozo(Buffer.alloc(1024, 1)));
    await exigirRechazoYCierre(c, 415, 'TIPO_NO_SOPORTADO', { maxBytes: MAX, chunked: true });
  });

  /** Envía la petición completa (cuerpo entero) y espera la respuesta: la conexión debe seguir abierta. */
  async function exigirSigueAbierta(
    cabeceras: Record<string, string | number>,
    cuerpo: Buffer,
    estadoEsperado: number,
  ): Promise<void> {
    const c = abrir(`PUT ${rutaFoto()}`, { ...cabeceras, 'Content-Length': cuerpo.length });
    await escribir(c.sock, cuerpo);
    await dormir(1_000);
    const texto = c.recibido();
    expect(estado(texto), texto.slice(0, 300)).toBe(estadoEsperado);
    expect(texto).not.toMatch(/connection: close/i);
    expect(c.cerrada(), 'la conexión sigue abierta').toBe(false);
  }

  it('un rechazo con el cuerpo ya completo no cierra la conexión', async () => {
    const supervisor = await sesionContrasena(ctx, e.A.supervisor, e.A.S1);
    await exigirSigueAbierta(
      { Authorization: `Bearer ${supervisor}`, 'Content-Type': 'image/png' },
      pngValido(),
      403,
    );
  });

  it('una subida válida sigue funcionando y no cierra la conexión', async () => {
    await exigirSigueAbierta(
      { Authorization: `Bearer ${e.A.tokenAdmin}`, 'Content-Type': 'image/png' },
      pngValido(),
      200,
    );
  });
});

describe('O3 · el cliente corta una subida autorizada a la mitad', () => {
  it('no deja un error en el registro ni guarda nada: un aviso y 400 PETICION_INVALIDA', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const claves = ctx.almacen.claves();
    const auditorias = async () =>
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM auditoria WHERE entidad_id = $1 AND accion = 'cambiar_foto_producto'",
          [datos.productoId],
        )
      ).rows[0]!.n;
    const antes = await auditorias();

    const c = abrir(`PUT ${rutaFoto()}`, {
      Authorization: `Bearer ${e.A.tokenAdmin}`,
      'Content-Type': 'image/png',
      'Content-Length': 500_000,
    });
    await escribir(c.sock, Buffer.alloc(2048, 1));
    await dormir(300);
    // Corta la conexión a la mitad (sin esperar respuesta).
    c.sock.destroy();
    await dormir(800);

    expect(error, 'no debe registrarse como error').not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledWith(expect.stringMatching(/cortó la subida/));
    expect(ctx.almacen.claves()).toEqual(claves);
    expect(await auditorias()).toBe(antes);
  });
});
