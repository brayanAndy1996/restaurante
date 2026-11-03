// Historia 005, ataque de la ronda 1 · pruebas del desarrollador (no protegidas) de las correcciones de la API. Las
// protegidas del ataque (`llamados-critica/ataque-ronda1.spec.ts`) las escribe test-writer; estas cubren por HTTP:
// - F1: el tope de 16 KB mide los bytes recibidos (escapes `\u`, cuerpo por partes) y `/PUBLICO/` es pública;
// - F2: la réplica del paso a la cuenta es solo de la misma persona (su usuario, desde cualquier sesión);
// - F3: atender con un `ordenId` que ya existe y no es la orden vigente de la mesa es 422 y no cambia nada;
// - F4: la misma IPv6 escrita de otra forma, o de su mismo /64, cuenta como la misma conexión (huella);
// - F6: dos sesiones de soporte distintas no son la misma persona; la misma sesión sí.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer } from '../acceso/fabrica-plataforma';
import { abrirCliente } from '../utilidades';
import {
  abrirMesa,
  atenderLlamado,
  atenderOk,
  clave,
  clienteNuevo,
  crearLlamado,
  cuerpoLlamarMozo,
  cuerpoPedido,
  descartarOk,
  esperarError,
  lineasDe,
  llamar,
  mesaConCodigo,
  mesaEnElMapa,
  mesasConCodigo,
  pasarLlamado,
  prepararEscenarioLlamados,
  arrancarLlamados,
  URL_CARTA,
  type AppLlamados,
  type EscenarioLlamados,
} from '../llamados-critica/fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;
const t = () => esc.token;

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

/** `POST` por `http` real con el cuerpo en partes (sin `Content-Length`). */
async function postPorPartes(
  ruta: string,
  cuerpo: string,
): Promise<{ status: number; body: string }> {
  const servidor = ctx.app.getHttpServer() as http.Server;
  const escuchando = servidor.listening ? servidor : servidor.listen(0);
  const puerto = (escuchando.address() as { port: number }).port;
  return new Promise((resolver, rechazar) => {
    const peticion = http.request(
      {
        port: puerto,
        method: 'POST',
        path: ruta,
        headers: {
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
          'cf-connecting-ip': '198.51.100.7',
        },
      },
      (respuesta) => {
        let datos = '';
        respuesta.on('data', (x) => (datos += String(x)));
        respuesta.on('end', () => resolver({ status: respuesta.statusCode ?? 0, body: datos }));
      },
    );
    peticion.on('error', rechazar);
    for (let i = 0; i < cuerpo.length; i += 4096) peticion.write(cuerpo.slice(i, i + 4096));
    peticion.end();
  });
}

describe('F1 · el tope de 16 KB mide los bytes recibidos', () => {
  it('un pedido válido que pesa más de 16 KB en el cable (escapes \\u) es 413 y no guarda nada', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const L = lineasDe(esc.carta);
    const observacion = '漢'.repeat(140);
    const cuerpo = cuerpoPedido(
      Array.from({ length: 30 }, () => ({ ...L.gaseosa(1), observacion })) as never,
    );
    const crudo = JSON.stringify(cuerpo).replace(/漢/g, '\\u6f22');
    expect(Buffer.byteLength(crudo)).toBeGreaterThan(16 * 1024);
    // Analizado, el mismo JSON pesa menos de 16 KB: justo lo que se medía antes.
    expect(Buffer.byteLength(JSON.stringify(JSON.parse(crudo)))).toBeLessThan(16 * 1024);
    for (const prefijo of ['/publico', '/PUBLICO', '/Publico']) {
      const res = await request(ctx.app.getHttpServer())
        .post(`${prefijo}/mesas/${mesa.codigo}/llamados`)
        .set('content-type', 'application/json')
        .set('cf-connecting-ip', '203.0.113.9')
        .send(crudo);
      expect(res.status, prefijo).toBe(413);
      expect(res.body.codigo).toBe('CUERPO_DEMASIADO_GRANDE');
    }
    const filas = await admin.query('SELECT 1 FROM llamado WHERE mesa_id = $1', [mesa.id]);
    expect(filas.rows).toHaveLength(0);
  });

  it('un cuerpo por partes de más de 16 KB (con espacios de relleno) es 413, también en mayúsculas', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const cuerpo = JSON.stringify(cuerpoLlamarMozo()) + ' '.repeat(20 * 1024);
    for (const prefijo of ['/publico', '/PUBLICO']) {
      const res = await postPorPartes(`${prefijo}/mesas/${mesa.codigo}/llamados`, cuerpo);
      expect(res.status, prefijo).toBe(413);
      expect(res.body).toContain('CUERPO_DEMASIADO_GRANDE');
    }
  });

  it('un cuerpo por partes de menos de 16 KB pasa', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const res = await postPorPartes(
      `/PUBLICO/mesas/${mesa.codigo}/llamados`,
      JSON.stringify(cuerpoLlamarMozo()),
    );
    expect(res.status).toBe(201);
  });

  it('el CORS del origen de la carta vale también para /PUBLICO/, y sigue sin valer en las rutas con sesión', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const pre = (ruta: string) =>
      request(ctx.app.getHttpServer())
        .options(ruta)
        .set('Origin', URL_CARTA)
        .set('Access-Control-Request-Method', 'POST');
    expect(
      (await pre(`/PUBLICO/mesas/${mesa.codigo}/llamados`)).headers['access-control-allow-origin'],
    ).toBe(URL_CARTA);
    expect((await pre('/llamados')).headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('F2 · la réplica del paso a la cuenta es solo de la misma persona', () => {
  it('la misma persona, desde otra sesión, recibe 200; otra persona, 409 LLAMADO_CERRADO con el estado', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const L = lineasDe(esc.carta);
    const c = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(2)]));
    await atenderOk(ctx, t().mozo, c.id);
    const lineas = [{ posicion: 0, cantidad: 2 }];
    const primera = await pasarLlamado(ctx, t().mozo, c.id, { lineas });
    expect(primera.status, primera.text).toBe(200);

    const otraSesion = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: '/llamados/' + c.id + '/paso-a-cuenta',
      cuerpo: { lineas },
      cabeceras: clave(),
    });
    expect(otraSesion.status).toBe(200);
    expect(otraSesion.body.lineas).toEqual(primera.body.lineas);

    const otraPersona = await pasarLlamado(ctx, t().mozo2, c.id, { lineas });
    esperarError(otraPersona, 409, 'LLAMADO_CERRADO');
    expect(otraPersona.body.estado).toBe('PASADO_A_CUENTA');
    expect(otraPersona.body.lineas).toBeUndefined();
  });
});

describe('F3 · atender con un ordenId que ya existe y no es la orden vigente de la mesa', () => {
  it('con la orden liberada es 422 DATOS_INVALIDOS con campos.ordenId y no cambia nada', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    const L = lineasDe(esc.carta);
    const c1 = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    const ordenId = randomUUID();
    await atenderOk(ctx, t().mozo, c1.id, { ordenId, comensales: 2 });
    await descartarOk(ctx, t().mozo, c1.id, { motivo: 'Pedido falso' });
    const liberada = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${ordenId}/liberacion`,
      cabeceras: clave(),
    });
    expect(liberada.status, liberada.text).toBe(200);

    const c2 = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(2)]));
    const antes = await admin.query('SELECT * FROM llamado WHERE id = $1', [c2.id]);
    const res = await atenderLlamado(ctx, t().mozo, c2.id, { ordenId, comensales: 3 });
    esperarError(res, 422, 'DATOS_INVALIDOS');
    expect(res.body.campos).toEqual([expect.objectContaining({ campo: 'ordenId' })]);
    // La mesa sigue libre, el llamado sigue pendiente y la orden vieja sigue anulada.
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    const despues = await admin.query('SELECT * FROM llamado WHERE id = $1', [c2.id]);
    expect(despues.rows).toEqual(antes.rows);
    expect(despues.rows[0].estado).toBe('PENDIENTE');
    const orden = await admin.query('SELECT estado FROM orden WHERE id = $1', [ordenId]);
    expect(orden.rows[0].estado).toBe('ANULADA');
    // Con un id nuevo, la misma mesa se abre normalmente.
    const bien = await atenderOk(ctx, t().mozo, c2.id, { ordenId: randomUUID(), comensales: 3 });
    expect(bien.body.mesaAbierta).toBe(true);
  });

  it('con la orden vigente de OTRA mesa también es 422 y la otra mesa no se toca', async () => {
    const [m1, m2] = await mesasConCodigo(ctx, esc, 2);
    const L = lineasDe(esc.carta);
    const ordenDeM1 = await abrirMesa(ctx, esc, m1!, t().mozo);
    const c = await crearLlamado(ctx, m2!, cuerpoPedido([L.gaseosa(1)]));
    const res = await atenderLlamado(ctx, t().mozo, c.id, { ordenId: ordenDeM1, comensales: 2 });
    esperarError(res, 422, 'DATOS_INVALIDOS');
    expect(res.body.campos).toEqual([expect.objectContaining({ campo: 'ordenId' })]);
    expect((await mesaEnElMapa(ctx, t().mozo, m2!.id)).estado).toBe('LIBRE');
    expect((await mesaEnElMapa(ctx, t().mozo, m1!.id)).estado).toBe('OCUPADA');
  });
});

describe('F4 · la IP en una sola forma y el /64 de la IPv6', () => {
  const huellas = async (mesaIds: string[]): Promise<number> => {
    const { rows } = await admin.query(
      'SELECT count(DISTINCT huella_ip)::int AS n FROM llamado WHERE mesa_id = ANY($1::uuid[])',
      [mesaIds],
    );
    return rows[0].n as number;
  };

  it('la misma IPv6 escrita de varias formas, y otra dirección de su /64, dejan la misma huella', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 4);
    const formas = [
      '2001:db8:0:1::5',
      '2001:0DB8:0:1:0:0:0:5',
      '2001:db8:0:1:ffff:eeee:dddd:cccc',
      '::ffff:203.0.113.77',
    ];
    for (const [i, ip] of formas.entries()) {
      const res = await clienteNuevo(ctx)
        .conIp(ip)
        .post(`/publico/mesas/${mesas[i]!.codigo}/llamados`, cuerpoLlamarMozo());
      expect(res.status, ip).toBe(201);
    }
    // Las tres primeras son un solo /64; la cuarta es una IPv4 mapeada (otra conexión).
    expect(await huellas(mesas.slice(0, 3).map((m) => m.id))).toBe(1);
    expect(await huellas(mesas.map((m) => m.id))).toBe(2);
  });

  it('la IPv4 mapeada y la IPv4 dejan la misma huella', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 2);
    await clienteNuevo(ctx)
      .conIp('203.0.113.88')
      .post(`/publico/mesas/${mesas[0]!.codigo}/llamados`, cuerpoLlamarMozo());
    await clienteNuevo(ctx)
      .conIp('::ffff:cb00:7158')
      .post(`/publico/mesas/${mesas[1]!.codigo}/llamados`, cuerpoLlamarMozo());
    expect(await huellas(mesas.map((m) => m.id))).toBe(1);
  });
});

describe('F6 · dos sesiones de soporte no son la misma persona', () => {
  async function abrirSoporte(): Promise<string> {
    const res = await ctx
      .http()
      .post(`/plataforma/empresas/${esc.e.A.empresaId}/soporte`)
      .set(bearer(esc.e.sa.token))
      .send({ motivo: `Soporte ${randomUUID().slice(0, 8)}`, sucursalId: esc.e.A.S1 });
    expect(res.status, res.text).toBe(201);
    return res.body.token as string;
  }

  it('la misma sesión recibe 200 al repetir; otra sesión de soporte y una persona, 409 LLAMADO_TOMADO', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    await abrirMesa(ctx, esc, mesa, t().mozo);
    const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const soporte1 = await abrirSoporte();
    const soporte2 = await abrirSoporte();

    const primera = await atenderLlamado(ctx, soporte1, c.id, {});
    expect(primera.status, primera.text).toBe(200);
    const misma = await atenderLlamado(ctx, soporte1, c.id, {});
    expect(misma.status, misma.text).toBe(200);
    expect(misma.body.mesaAbierta).toBe(false);

    esperarError(await atenderLlamado(ctx, soporte2, c.id, {}), 409, 'LLAMADO_TOMADO');
    esperarError(await atenderLlamado(ctx, t().mozo, c.id, {}), 409, 'LLAMADO_TOMADO');
    const fila = await admin.query(
      'SELECT atendido_por_usuario_id, atendido_por_sesion_id FROM llamado WHERE id = $1',
      [c.id],
    );
    expect(fila.rows[0].atendido_por_usuario_id).toBeNull();
    expect(fila.rows[0].atendido_por_sesion_id).not.toBeNull();
  });

  it('un llamado atendido por una persona no se repite con una sesión de soporte', async () => {
    const mesa = await mesaConCodigo(ctx, esc);
    await abrirMesa(ctx, esc, mesa, t().mozo);
    const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await atenderOk(ctx, t().mozo, c.id, {});
    esperarError(await atenderLlamado(ctx, await abrirSoporte(), c.id, {}), 409, 'LLAMADO_TOMADO');
  });
});
