// spec: 005-carta-web-mesa (pruebas protegidas)
//
// Ataque a la entrega 5a, ronda 1. Cada falla que reportó el adversarial se convierte aquí en una prueba:
//
// - F1 (criterio 17): el tope de 16 KB de los `POST` públicos se mide por los bytes recibidos (no por el JSON ya
//   analizado), vale con `Transfer-Encoding: chunked` y con relleno de espacios, y la ruta pública se reconoce sin
//   distinguir mayúsculas (`/PUBLICO/...`, `/Publico/...`); y esas rutas reciben el mismo CORS de la carta que en
//   minúsculas, o ninguno, nunca el CORS con sesión.
// - F2 (criterio 51): la réplica del paso a la cuenta que responde 200 con las líneas es solo para la misma persona
//   (mismo usuario, desde cualquier sesión); otra persona recibe 409 `LLAMADO_CERRADO` con `estado`, sin líneas.
// - F3 (criterio 42): atender con el `ordenId` de una orden que ya existe y no es una orden vigente de esa mesa
//   (liberada, anulada o de otra mesa) es 422 `DATOS_INVALIDOS` con `campos` de `ordenId`, sin abrir la mesa.
// - F4 (criterio 33): la misma IP escrita de formas distintas es una sola conexión; en IPv6 el límite se cuenta por
//   prefijo /64; dos /64 distintos no comparten límite.
// - F5 (criterios 29 y 34): una petición con un `id` ya en curso solo se deja pasar si su cuerpo es idéntico al de la
//   que está en curso; si es otro cuerpo, cuenta para el tope de creaciones en curso (429).
// - F6 (criterio 43): una sesión de soporte distinta de la que atendió no es "la misma persona" (409
//   `LLAMADO_TOMADO`); la misma sesión de soporte recibe 200.
//
// Solo usa contratos públicos: la API real, las rutas de la tabla de endpoints de `spec.md` y un cliente
// administrador de solo lectura para contar filas. No lee la implementación.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { ORIGEN_DE_LA_PWA } from './fabrica-aislamiento';
import { anularOrdenOk, sesionContrasena } from '../salon-critica/fabrica-p2';
import { CABECERA_IP_DE_PRUEBA } from '../soporte/cliente-publico';
import {
  HORA_DE_SERVICIO,
  URL_CARTA,
  abrirMesa,
  arrancarLlamados,
  atenderLlamado,
  atenderOk,
  clave,
  clienteNuevo,
  conteoDePedidos,
  contarLlamadosDeMesa,
  crearLlamado,
  cuerpoLlamarMozo,
  cuerpoPedido,
  cuerpoPedirCuenta,
  descartarOk,
  enviarLlamado,
  esperarError,
  eventosDeLlamado,
  exigirEstado,
  filaLlamado,
  lineasDe,
  limpiarRegistros,
  llamar,
  mesaConCodigo,
  mesaEnElMapa,
  mesasConCodigo,
  nombreDe,
  ordenesAbiertasDeLaMesa,
  pasarLlamado,
  prepararEscenarioLlamados,
  rutaDeLlamados,
  type AppLlamados,
  type EscenarioLlamados,
  type LineaCuerpo,
  type MesaLlamados,
  type Res,
} from './fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;
let L: ReturnType<typeof lineasDe>;

const t = () => esc.token;
const A = () => esc.e.A;
const nuevaMesa = (): Promise<MesaLlamados> => mesaConCodigo(ctx, esc);

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(HORA_DE_SERVICIO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ===================================================================================================
// F1 · Criterio 17 · el tope de 16 KB
// ===================================================================================================

const TOPE = 16 * 1024;
const ESPACIOS_90_KB = ' '.repeat(90 * 1024);

/** Un pedido válido cuyo JSON compacto pesa menos de 16 KB pero escrito con escapes `\u` pesa unos 28 KB. */
function pedidoDe28KbEscapado(): { crudo: string; compacto: string } {
  const obs = 'ñ'.repeat(140);
  const lineas = Array.from({ length: 30 }, (): LineaCuerpo => ({
    ...L.gaseosa(1),
    observacion: obs,
  }));
  const compacto = JSON.stringify(cuerpoPedido(lineas, { nota: obs }));
  const crudo = compacto.replace(/ñ/g, '\\u00f1');
  return { crudo, compacto };
}

let siguienteIpCruda = 0;
const ipCruda = (): string => `203.0.113.${(siguienteIpCruda += 1) % 250}`;

/** `POST` con el cuerpo tal cual (texto), sin pasar por supertest: `Content-Length` o `Transfer-Encoding: chunked`. */
function postCrudo(
  ruta: string,
  cuerpo: string,
  opciones: { chunked: boolean; ip?: string },
): Promise<{ status: number; texto: string }> {
  const puerto = (ctx.app.getHttpServer().address() as AddressInfo).port;
  const cabeceraIp = process.env.CABECERA_IP_CLIENTE ?? CABECERA_IP_DE_PRUEBA;
  const bytes = Buffer.from(cuerpo, 'utf8');
  return new Promise((resolve, reject) => {
    let respondio = false;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: puerto,
        method: 'POST',
        path: ruta,
        headers: {
          'content-type': 'application/json',
          connection: 'close',
          [cabeceraIp]: opciones.ip ?? ipCruda(),
          ...(opciones.chunked
            ? { 'transfer-encoding': 'chunked' }
            : { 'content-length': String(bytes.length) }),
        },
      },
      (res) => {
        respondio = true;
        const partes: Buffer[] = [];
        res.on('data', (x: Buffer) => partes.push(x));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8') }),
        );
        res.on('error', () =>
          resolve({ status: res.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8') }),
        );
      },
    );
    req.on('error', (e) => {
      if (!respondio) reject(e);
    });
    for (let i = 0; i < bytes.length; i += 4096) req.write(bytes.subarray(i, i + 4096));
    req.end();
  });
}

describe('F1 · criterio 17 · el tope de 16 KB se mide por los bytes recibidos', () => {
  it('el pedido de ejemplo es válido: compacto pesa menos de 16 KB, escrito con escapes pasa de 16 KB y se acepta en minúsculas compacto', async () => {
    const { crudo, compacto } = pedidoDe28KbEscapado();
    expect(Buffer.byteLength(compacto)).toBeLessThan(TOPE);
    expect(Buffer.byteLength(crudo)).toBeGreaterThan(27 * 1024);
    expect(Buffer.byteLength(crudo)).toBeLessThan(30 * 1024);
    // Control: el mismo pedido, compacto, es un llamado válido.
    const mesa = await nuevaMesa();
    const res = await postCrudo(rutaDeLlamados(mesa.codigo), compacto, { chunked: false });
    expect(res.status, res.texto).toBe(201);
  });

  it.each(['/publico', '/PUBLICO', '/Publico'])(
    'un pedido válido de unos 28 KB (escapes \\u) a %s/mesas/<código>/llamados responde 413 CUERPO_DEMASIADO_GRANDE y no crea nada',
    async (prefijo) => {
      const { crudo } = pedidoDe28KbEscapado();
      const mesa = await nuevaMesa();
      const antes = await conteoDePedidos(admin, mesa.empresaId);
      const res = await clienteNuevo(ctx)
        .post(`${prefijo}/mesas/${mesa.codigo}/llamados`)
        .set('content-type', 'application/json')
        .send(crudo);
      expect({ status: res.status, codigo: res.body?.codigo }).toEqual({
        status: 413,
        codigo: 'CUERPO_DEMASIADO_GRANDE',
      });
      expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(0);
      expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
    },
  );

  it.each(['/publico', '/PUBLICO'])(
    'un LLAMAR_MOZO con 90 KB de espacios de relleno en chunked a %s/mesas/<código>/llamados responde 413 y no crea nada',
    async (prefijo) => {
      const mesa = await nuevaMesa();
      const cuerpo = JSON.stringify(cuerpoLlamarMozo()) + ESPACIOS_90_KB;
      const res = await postCrudo(`${prefijo}/mesas/${mesa.codigo}/llamados`, cuerpo, {
        chunked: true,
      });
      expect(res.status, res.texto.slice(0, 200)).toBe(413);
      expect(JSON.parse(res.texto || '{}')).toMatchObject({ codigo: 'CUERPO_DEMASIADO_GRANDE' });
      expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(0);
    },
  );

  it('el relleno de espacios con Content-Length también se rechaza, y un cuerpo chunked pequeño sigue pasando', async () => {
    const mesa = await nuevaMesa();
    const grande = await postCrudo(
      rutaDeLlamados(mesa.codigo),
      JSON.stringify(cuerpoLlamarMozo()) + ESPACIOS_90_KB,
      { chunked: false },
    );
    expect(grande.status, grande.texto.slice(0, 200)).toBe(413);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(0);
    const chico = await postCrudo(rutaDeLlamados(mesa.codigo), JSON.stringify(cuerpoLlamarMozo()), {
      chunked: true,
    });
    expect(chico.status, chico.texto).toBe(201);
  });
});

describe('F1 · criterio 16 · las rutas públicas en mayúsculas reciben el mismo CORS que en minúsculas, o ninguno', () => {
  const cabecera = (res: { headers: Record<string, unknown> }, nombre: string): string =>
    String(res.headers[nombre] ?? '');
  const ORIGEN_PWA = ORIGEN_DE_LA_PWA;

  it.each(['/PUBLICO', '/Publico'])(
    'el preflight y el POST real de %s desde el origen de la carta: el origen de la carta o nada, nunca credenciales',
    async (prefijo) => {
      const mesa = await nuevaMesa();
      const minuscula = await clienteNuevo(ctx)
        .conOrigen(URL_CARTA)
        .options(`/publico/mesas/${mesa.codigo}/llamados`)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');
      expect(cabecera(minuscula, 'access-control-allow-origin')).toBe(URL_CARTA);

      const pre = await clienteNuevo(ctx)
        .conOrigen(URL_CARTA)
        .options(`${prefijo}/mesas/${mesa.codigo}/llamados`)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type');
      expect([URL_CARTA, '']).toContain(cabecera(pre, 'access-control-allow-origin'));
      expect(cabecera(pre, 'access-control-allow-credentials')).not.toBe('true');

      const real = await clienteNuevo(ctx)
        .conOrigen(URL_CARTA)
        .post(`${prefijo}/mesas/${mesa.codigo}/llamados`, cuerpoLlamarMozo());
      expect([URL_CARTA, '']).toContain(cabecera(real, 'access-control-allow-origin'));
      expect(cabecera(real, 'access-control-allow-credentials')).not.toBe('true');
    },
  );

  it.each(['/PUBLICO', '/Publico'])(
    'un origen ajeno no recibe permiso en %s ni con credenciales, y el origen de la PWA no gana credenciales que /publico no da a la carta',
    async (prefijo) => {
      const mesa = await nuevaMesa();
      for (const origen of ['https://malo.example', 'null']) {
        const pre = await clienteNuevo(ctx)
          .conOrigen(origen)
          .options(`${prefijo}/mesas/${mesa.codigo}/llamados`)
          .set('Access-Control-Request-Method', 'POST');
        expect(cabecera(pre, 'access-control-allow-origin'), origen).not.toBe(origen);
        expect(cabecera(pre, 'access-control-allow-origin'), origen).not.toBe('*');
      }
      {
        const minus = await clienteNuevo(ctx)
          .conOrigen(ORIGEN_PWA)
          .options(`/publico/mesas/${mesa.codigo}/llamados`)
          .set('Access-Control-Request-Method', 'POST');
        const may = await clienteNuevo(ctx)
          .conOrigen(ORIGEN_PWA)
          .options(`${prefijo}/mesas/${mesa.codigo}/llamados`)
          .set('Access-Control-Request-Method', 'POST');
        // Lo que recibe en mayúsculas es lo mismo que en minúsculas, o nada.
        expect([cabecera(minus, 'access-control-allow-origin'), '']).toContain(
          cabecera(may, 'access-control-allow-origin'),
        );
      }
    },
  );
});

// ===================================================================================================
// F2 · Criterio 51 · el paso repetido por otra persona
// ===================================================================================================

const lineasDelPedido = (): LineaCuerpo[] => [L.lomo(['3/4', 'Huevo'], 2), L.gaseosa(1)];
const todasLasLineas = () => [
  { posicion: 0, cantidad: 2 },
  { posicion: 1, cantidad: 1 },
];

/** Crea el pedido en una mesa libre y lo atiende el Mozo (que abre la mesa). */
async function pedidoAtendido(): Promise<{ mesa: MesaLlamados; id: string; ordenId: string }> {
  const mesa = await nuevaMesa();
  const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido()));
  const ordenId = randomUUID();
  await atenderOk(ctx, t().mozo, creado.id, { ordenId, comensales: 2 });
  return { mesa, id: creado.id, ordenId };
}

function esperarCerradoSinLineas(res: Res): void {
  esperarError(res, 409, 'LLAMADO_CERRADO');
  expect(res.body.estado).toBe('PASADO_A_CUENTA');
  expect(res.body.lineas).toBeUndefined();
  expect(res.body.llamado).toBeUndefined();
}

describe('F2 · criterio 51 · la réplica del paso con líneas es solo para la misma persona', () => {
  it('Mozo y Mozo2 pasan a la vez con claves distintas: uno recibe 200 con las líneas y el otro 409 LLAMADO_CERRADO; después el Cajero también 409 y el que ganó, con otra clave, 200 con las mismas líneas', async () => {
    const p = await pedidoAtendido();
    await limpiarRegistros(ctx);

    const [a, b] = await Promise.all([
      pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() }),
      pasarLlamado(ctx, t().mozo2, p.id, { lineas: todasLasLineas() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ganador = a.status === 200 ? a : b;
    const perdedor = a.status === 200 ? b : a;
    const personaGanadora = a.status === 200 ? A().mozo : esc.mozo2;
    const tokenGanador = a.status === 200 ? t().mozo : t().mozo2;
    esperarCerradoSinLineas(perdedor);
    expect(ganador.body.lineas).toHaveLength(2);
    expect(ganador.body.llamado.cerradoPor).toEqual({
      id: personaGanadora.id,
      nombre: nombreDe(personaGanadora),
    });

    // Después, el Cajero (otra persona con ATENDER_MESA) tampoco recibe las líneas.
    esperarCerradoSinLineas(
      await pasarLlamado(ctx, t().cajero, p.id, { lineas: todasLasLineas() }),
    );
    // Ni quien perdió, ahora que ya está pasado.
    esperarCerradoSinLineas(
      await pasarLlamado(ctx, a.status === 200 ? t().mozo2 : t().mozo, p.id, {
        lineas: todasLasLineas(),
      }),
    );

    // El que ganó, con otra clave, recibe 200 con las mismas líneas (la misma persona).
    const otraClave = await pasarLlamado(ctx, tokenGanador, p.id, { lineas: todasLasLineas() });
    exigirEstado(otraClave, 200, 'la misma persona con otra clave');
    expect(otraClave.body.lineas).toEqual(ganador.body.lineas);
    expect(otraClave.body.ordenId).toBe(ganador.body.ordenId);
    expect(otraClave.body.llamado.cerradoPor).toEqual(ganador.body.llamado.cerradoPor);

    // Nada cambió en la fila y solo hubo un aviso.
    const fila = (await filaLlamado(admin, p.mesa.empresaId, p.id))!;
    expect(fila.estado).toBe('PASADO_A_CUENTA');
    expect(fila.cerrado_por_usuario_id).toBe(personaGanadora.id);
    expect(await eventosDeLlamado(ctx, 'llamado.cambio')).toHaveLength(1);
  });

  it('en secuencia: el Mozo pasa; Mozo2 y el Cajero con las mismas líneas reciben 409 LLAMADO_CERRADO con estado y sin líneas; el Mozo desde otra sesión recibe 200 con las mismas líneas', async () => {
    const p = await pedidoAtendido();
    const primera = await pasarLlamado(ctx, t().mozo, p.id, { lineas: todasLasLineas() });
    exigirEstado(primera, 200, 'pasar a la cuenta');
    await limpiarRegistros(ctx);

    for (const token of [t().mozo2, t().cajero]) {
      esperarCerradoSinLineas(await pasarLlamado(ctx, token, p.id, { lineas: todasLasLineas() }));
    }

    const otraSesion = await sesionContrasena(ctx, A().mozo, A().S1);
    for (const token of [t().mozo, otraSesion]) {
      const replica = await pasarLlamado(ctx, token, p.id, { lineas: todasLasLineas() });
      exigirEstado(replica, 200, 'la misma persona (otra clave / otra sesión)');
      expect(replica.body.lineas).toEqual(primera.body.lineas);
      expect(replica.body.ordenId).toBe(primera.body.ordenId);
      expect(replica.body.llamado.cerradoEn).toBe(primera.body.llamado.cerradoEn);
    }

    const fila = (await filaLlamado(admin, p.mesa.empresaId, p.id))!;
    expect(fila.cerrado_por_usuario_id).toBe(A().mozo.id);
    expect(await eventosDeLlamado(ctx)).toEqual([]);
  });
});

// ===================================================================================================
// F3 · Criterio 42 · atender con el ordenId de una orden que no es vigente de esa mesa
// ===================================================================================================

async function esperarAtenderRechazado(
  mesa: MesaLlamados,
  llamadoId: string,
  ordenId: string,
  estricto = true,
): Promise<void> {
  const antes = await conteoDePedidos(admin, mesa.empresaId);
  const res = await atenderLlamado(ctx, t().mozo, llamadoId, { ordenId, comensales: 3 });
  if (estricto) {
    esperarError(res, 422, 'DATOS_INVALIDOS');
    const campos = (res.body.campos ?? []) as { campo: string }[];
    expect(campos.map((c) => c.campo)).toContain('ordenId');
  } else {
    expect(res.status, res.text).toBe(422);
  }
  expect(res.body.mesaAbierta).toBeUndefined();
  const fila = (await filaLlamado(admin, mesa.empresaId, llamadoId))!;
  expect(fila.estado).toBe('PENDIENTE');
  expect(fila.atendido_por_usuario_id).toBeNull();
  expect(fila.atendido_en).toBeNull();
  expect(fila.orden_id).toBeNull();
  expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
}

describe('F3 · criterio 42 · atender con un ordenId que ya existe y no es una orden vigente de la mesa', () => {
  it('de una orden ya liberada: 422 DATOS_INVALIDOS con campos.ordenId, el llamado sigue PENDIENTE y la mesa sigue LIBRE', async () => {
    const mesa = await nuevaMesa();
    const L1 = L.gaseosa(1);
    const c1 = await crearLlamado(ctx, mesa, cuerpoPedido([L1]));
    const x = randomUUID();
    await atenderOk(ctx, t().mozo, c1.id, { ordenId: x, comensales: 2 });
    await descartarOk(ctx, t().mozo, c1.id, { motivo: 'Pedido falso' });
    const liberar = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${x}/liberacion`,
      cabeceras: clave(),
    });
    exigirEstado(liberar, 200, 'liberar la mesa (004, criterio 44)');
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    const estadoDeX = (await admin.query('SELECT estado, version FROM orden WHERE id = $1', [x]))
      .rows[0];

    const c2 = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(2)]));
    await limpiarRegistros(ctx);
    await esperarAtenderRechazado(mesa, c2.id, x);

    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
    expect(
      (await admin.query('SELECT estado, version FROM orden WHERE id = $1', [x])).rows[0],
    ).toEqual(estadoDeX);
    expect(await eventosDeLlamado(ctx)).toEqual([]);
  });

  it('de una orden anulada: 422 DATOS_INVALIDOS con campos.ordenId y nada cambia', async () => {
    const mesa = await nuevaMesa();
    const c1 = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const x = randomUUID();
    await atenderOk(ctx, t().mozo, c1.id, { ordenId: x, comensales: 2 });
    await anularOrdenOk(ctx, t().supervisor, x);
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    const c2 = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await esperarAtenderRechazado(mesa, c2.id, x);
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
  });

  it('de la orden vigente de otra mesa: 422 (sea cual sea su código) sin abrir la mesa libre; la otra mesa no se toca', async () => {
    const [otra, libre] = await mesasConCodigo(ctx, esc, 2);
    const ordenAjena = await abrirMesa(ctx, esc, otra!, t().mozo2, { comensales: 2 });
    const c = await crearLlamado(ctx, libre!, cuerpoLlamarMozo());
    await esperarAtenderRechazado(libre!, c.id, ordenAjena, false);
    expect((await mesaEnElMapa(ctx, t().mozo, libre!.id)).estado).toBe('LIBRE');
    expect(await ordenesAbiertasDeLaMesa(admin, otra!.id)).toEqual([ordenAjena]);
    expect(await ordenesAbiertasDeLaMesa(admin, libre!.id)).toEqual([]);
  });
});

// ===================================================================================================
// F4 · Criterio 33 · la IP canónica
// ===================================================================================================

/** 2001:db8::1 escrita de 23 maneras distintas (todas la misma dirección). */
const FORMAS_DE_2001_DB8_1 = [
  '2001:db8::1',
  '2001:DB8::1',
  '2001:0db8::1',
  '2001:0DB8::1',
  '2001:db8:0::1',
  '2001:db8:0:0::1',
  '2001:db8:0:0:0::1',
  '2001:db8:0:0:0:0::1',
  '2001:db8:0:0:0:0:0:1',
  '2001:0db8:0000:0000:0000:0000:0000:0001',
  '2001:db8::0001',
  '2001:db8::01',
  '2001:db8::001',
  '2001:db8:0000::1',
  '2001:db8:00::1',
  '2001:db8:000::1',
  '2001:db8::0:1',
  '2001:db8::0:0:1',
  '2001:db8::0:0:0:1',
  '2001:db8:0::0:1',
  '2001:0DB8:0:0:0:0:0:0001',
  '2001:DB8:0000::0001',
  '2001:db8::0.0.0.1',
];

async function crearDesdeIp(mesa: MesaLlamados, ip: string): Promise<Res> {
  return enviarLlamado(clienteNuevo(ctx).conIp(ip), mesa.codigo, cuerpoLlamarMozo());
}

describe('F4 · criterio 33 · la misma IP escrita de formas distintas es una sola conexión', () => {
  it('las 23 formas del ejemplo son la misma dirección (control de la prueba)', () => {
    expect(new Set(FORMAS_DE_2001_DB8_1).size).toBe(FORMAS_DE_2001_DB8_1.length);
    const canonicas = new Set(FORMAS_DE_2001_DB8_1.map((f) => new URL(`http://[${f}]/`).hostname));
    expect([...canonicas]).toEqual(['[2001:db8::1]']);
  });

  it('22 llamados a 22 mesas desde 2001:db8::1 escrita de 22 formas: las peticiones 21 y 22 reciben 429 DEMASIADOS_LLAMADOS', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 22);
    const estados: number[] = [];
    let ultima: Res | undefined;
    for (let i = 0; i < 22; i += 1) {
      ultima = await crearDesdeIp(mesas[i]!, FORMAS_DE_2001_DB8_1[i]!);
      estados.push(ultima.status);
    }
    expect(estados.slice(0, 20)).toEqual(Array(20).fill(201));
    expect(estados.slice(20)).toEqual([429, 429]);
    esperarError(ultima!, 429, 'DEMASIADOS_LLAMADOS');
    expect(await contarLlamadosDeMesa(admin, mesas[20]!.id)).toBe(0);
    expect(await contarLlamadosDeMesa(admin, mesas[21]!.id)).toBe(0);
  });

  it('una IPv4 y su forma ::ffff:a.b.c.d son una sola conexión', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 22);
    const estados: number[] = [];
    for (let i = 0; i < 22; i += 1) {
      const ip = i % 2 === 0 ? '198.51.100.77' : '::ffff:198.51.100.77';
      estados.push((await crearDesdeIp(mesas[i]!, ip)).status);
    }
    expect(estados.slice(0, 20)).toEqual(Array(20).fill(201));
    expect(estados.slice(20)).toEqual([429, 429]);
  });
});

describe('F4 · criterio 33 · en IPv6 el límite se cuenta por prefijo /64', () => {
  it('22 llamados desde 22 direcciones del mismo /64: las peticiones 21 y 22 reciben 429', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 22);
    const estados: number[] = [];
    for (let i = 0; i < 22; i += 1) {
      estados.push(
        (await crearDesdeIp(mesas[i]!, `2001:db8:aaaa:1::${(i + 1).toString(16)}`)).status,
      );
    }
    expect(estados.slice(0, 20)).toEqual(Array(20).fill(201));
    expect(estados.slice(20)).toEqual([429, 429]);
  });

  it('dos /64 distintos no comparten límite: 20 desde uno, 20 desde el otro (cada uno con su propia 21.ª rechazada)', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 42);
    const primero: number[] = [];
    const segundo: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      primero.push(
        (await crearDesdeIp(mesas[i]!, `2001:db8:bbbb:1::${(i + 1).toString(16)}`)).status,
      );
    }
    for (let i = 0; i < 20; i += 1) {
      segundo.push(
        (await crearDesdeIp(mesas[20 + i]!, `2001:db8:bbbb:2::${(i + 1).toString(16)}`)).status,
      );
    }
    expect(primero).toEqual(Array(20).fill(201));
    expect(segundo).toEqual(Array(20).fill(201));
    // Cada /64 llegó a su propio límite.
    esperarError(
      await crearDesdeIp(mesas[40]!, '2001:db8:bbbb:1:ffff::9'),
      429,
      'DEMASIADOS_LLAMADOS',
    );
    esperarError(
      await crearDesdeIp(mesas[41]!, '2001:db8:bbbb:2:ffff::9'),
      429,
      'DEMASIADOS_LLAMADOS',
    );
  });
});

// ===================================================================================================
// F5 · Criterios 29 y 34 · el tope de creaciones en curso
// ===================================================================================================

describe('F5 · criterio 29 · el tope de creaciones en curso con el mismo id', () => {
  it('40 simultáneas con el mismo id y cuerpos alternos (LLAMAR_MOZO / PEDIR_CUENTA): hay 429 y no se crea más de un llamado', async () => {
    const mesa = await nuevaMesa();
    const id = randomUUID();
    const respuestas = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        enviarLlamado(
          clienteNuevo(ctx),
          mesa.codigo,
          i % 2 === 0 ? cuerpoLlamarMozo(id) : cuerpoPedirCuenta(id),
        ),
      ),
    );
    const estados = respuestas.map((r) => r.status);
    expect(estados.filter((s) => s === 429).length, estados.join(',')).toBeGreaterThan(0);
    for (const s of estados) expect([201, 409, 422, 429]).toContain(s);
    for (const r of respuestas.filter((x) => x.status === 429)) {
      expect(r.body.codigo).toBe('DEMASIADOS_LLAMADOS');
    }
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
  });

  it('40 réplicas idénticas simultáneas (mismo id y mismo cuerpo) siguen pasando: ninguna 429, un solo llamado y el mismo cuerpo en todas las 201', async () => {
    const mesa = await nuevaMesa();
    const cuerpo = cuerpoLlamarMozo();
    const respuestas = await Promise.all(
      Array.from({ length: 40 }, () => enviarLlamado(clienteNuevo(ctx), mesa.codigo, cuerpo)),
    );
    const estados = respuestas.map((r) => r.status);
    for (const s of estados) expect([201, 409], estados.join(',')).toContain(s);
    const creadas = respuestas.filter((r) => r.status === 201);
    expect(creadas.length).toBeGreaterThan(0);
    for (const r of creadas) expect(r.body).toEqual(creadas[0]!.body);
    expect(await contarLlamadosDeMesa(admin, mesa.id)).toBe(1);
  });
});

// ===================================================================================================
// F6 · Criterio 43 · soporte
// ===================================================================================================

async function abrirSoporte(): Promise<string> {
  const res = await llamar(ctx, esc.e.sa.token, {
    metodo: 'post',
    ruta: `/plataforma/empresas/${A().empresaId}/soporte`,
    cuerpo: { motivo: 'Atender llamados', sucursalId: A().S1 },
  });
  exigirEstado(res, 201, 'abrir soporte');
  return res.body.token as string;
}

describe('F6 · criterio 43 · una sesión de soporte distinta no es la misma persona', () => {
  it('si lo atendió una sesión de soporte, otra sesión de soporte recibe 409 LLAMADO_TOMADO y la misma sesión, 200', async () => {
    const mesa = await nuevaMesa();
    await abrirMesa(ctx, esc, mesa, t().mozo);
    const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const soporte1 = await abrirSoporte();
    const soporte2 = await abrirSoporte();
    expect(soporte2).not.toBe(soporte1);

    const primera = await atenderLlamado(ctx, soporte1, c.id, {});
    exigirEstado(primera, 200, 'atender con soporte (mesa ocupada)');
    const antes = await filaLlamado(admin, mesa.empresaId, c.id);
    expect(antes!.estado).toBe('ATENDIDO');
    await limpiarRegistros(ctx);

    esperarError(await atenderLlamado(ctx, soporte2, c.id, {}), 409, 'LLAMADO_TOMADO');
    esperarError(await atenderLlamado(ctx, t().mozo2, c.id, {}), 409, 'LLAMADO_TOMADO');

    const misma = await atenderLlamado(ctx, soporte1, c.id, {});
    exigirEstado(misma, 200, 'la misma sesión de soporte con otra clave');
    expect(misma.body.llamado.estado).toBe('ATENDIDO');
    expect(misma.body.llamado.atendidoEn).toBe(primera.body.llamado.atendidoEn);

    expect(await filaLlamado(admin, mesa.empresaId, c.id)).toEqual(antes);
    expect(await eventosDeLlamado(ctx)).toEqual([]);
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toHaveLength(1);
  });
});
