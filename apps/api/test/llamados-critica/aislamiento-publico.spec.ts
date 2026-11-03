// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P1 (parte 5) · Aislamiento por HTTP de las rutas públicas y de las rutas nuevas con sesión (ruta crítica),
// criterios 15, 16, 66 y 67:
// - 15: con el código de una mesa de A, cada ruta pública lee y escribe solo filas de A y de la sucursal de esa mesa:
//   un `productoId` o un modificador de B, o de A que no se vende en esa sucursal, responde 422 con el mismo cuerpo
//   que uno inexistente; el `id` de un llamado de B usado con el código de A responde 404 en el estado y, en un
//   `POST`, crea su propio llamado en A sin tocar ni revelar el de B (la llave es `(empresa_id, id)`);
// - 16: CORS: las rutas `/publico/*` aceptan además el origen de la carta web (`GET`, `POST` y `OPTIONS`;
//   cabeceras `Content-Type` e `If-None-Match`; expone `ETag` y `Retry-After`; sin credenciales); las demás rutas
//   siguen aceptando solo `ORIGENES_PERMITIDOS`: el origen de la carta no recibe permiso en `/sesion`, `/llamados`
//   ni ninguna otra;
// - 66: en toda ruta autenticada de la sección, un id de B en la ruta responde 404 con el mismo cuerpo que uno
//   inexistente y sin cambios en B; los ids de cliente (`llamado.id`, el `ordenId` de la atención) son únicos por
//   empresa: el mismo UUID usado en B crea su propia fila;
// - 67: con un pool de 2 conexiones, 100 peticiones simultáneas que alternan A y B entre la carta, crear un llamado,
//   su estado y `GET /llamados` devuelven y cambian solo datos de su empresa, y cada evento va solo a su sala.
// Hoy las rutas públicas responden 401 y las nuevas lanzan "No implementado": las pruebas fallan por eso.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  CARTA_WEB_URL,
  ORIGEN_DE_LA_PWA,
  arrancarAislamiento,
  asentar,
  atenderLlamado,
  clave,
  clientePublico,
  crearLlamadoOk,
  crearMundo,
  exigirEstado,
  exigirSinFallos,
  fotoDeLlamados,
  filaComoJson,
  llamar,
  llamarAlMozo,
  mesasNuevas,
  pedidoDeLomo,
  postConClave,
  rutaDeLlamados,
  sembrarLlamados,
  sesiones,
  type AppP4,
  type EmpresaDelMundo,
  type LlamadosSembrados,
  type MesaDelMundo,
  type Mundo,
} from './fabrica-aislamiento';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP4;
let admin: Client;

interface Sembrado {
  m: Mundo;
  sA: LlamadosSembrados;
  sB: LlamadosSembrados;
}

let sembradoPendiente: Promise<Sembrado> | undefined;
function sembrado(): Promise<Sembrado> {
  sembradoPendiente ??= (async () => {
    const m = await crearMundo(ctx);
    const sA = await sembrarLlamados(ctx, m.A, clientePublico(ctx), m.e.mozo2);
    const sB = await sembrarLlamados(ctx, m.B, clientePublico(ctx));
    return { m, sA, sB };
  })();
  return sembradoPendiente;
}

beforeAll(async () => {
  ctx = await arrancarAislamiento({ poolMax: 2 });
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const filasDelLlamado = async (id: string) =>
  (
    await admin.query<{ empresa_id: string; mesa_id: string; tipo: string; estado: string }>(
      `SELECT empresa_id, mesa_id, tipo, estado FROM llamado WHERE id = $1 ORDER BY empresa_id`,
      [id],
    )
  ).rows;

const cuantosLlamados = async (empresaId: string): Promise<number> =>
  (
    await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM llamado WHERE empresa_id = $1`,
      [empresaId],
    )
  ).rows[0]!.n;

// ------------------------------------------------------------------------------------------------
// 15 · Productos y modificadores de otra empresa o que la sucursal no vende
// ------------------------------------------------------------------------------------------------
describe('criterio 15 · un llamado con ids de B, o de A que S1 no vende, es un 422 igual al de un id inexistente', () => {
  it('control: el mismo pedido con productos y modificadores de A y de S1 se acepta', async () => {
    const { m } = await sembrado();
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const res = await clientePublico(ctx).post(
      rutaDeLlamados(mesa!.codigo),
      pedidoDeLomo(m.A.carta),
    );
    exigirEstado(res, 201, 'el pedido de control');
  });

  async function intentar(
    mesa: MesaDelMundo,
    lineas: { productoId: string; modificadorIds: string[]; cantidad: number }[],
  ) {
    const id = randomUUID();
    const res = await clientePublico(ctx).post(rutaDeLlamados(mesa.codigo), {
      id,
      tipo: 'PEDIDO',
      lineas,
    });
    const filas = await filasDelLlamado(id);
    return { res, filas };
  }

  it('un productoId de B (con el mismo nombre que uno de A), o de A que S1 no vende, responde lo mismo que uno inexistente', async () => {
    const { m } = await sembrado();
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const linea = (productoId: string) => ({
      productoId,
      modificadorIds: [] as string[],
      cantidad: 1,
    });
    const inexistente = await intentar(mesa!, [linea(randomUUID())]);
    expect(inexistente.res.status, inexistente.res.text).toBe(422);
    expect(inexistente.filas).toEqual([]);
    const casos: [string, string][] = [
      ['el lomo saltado de B', m.B.carta.lomoId],
      ['el combo de B', m.B.carta.comboId],
      ['el producto exclusivo de B', m.B.productoExclusivo.id],
      ['un producto de A que S1 no vende', m.A.productoExclusivo.id],
    ];
    const fallos: string[] = [];
    for (const [nombre, productoId] of casos) {
      const { res, filas } = await intentar(mesa!, [linea(productoId)]);
      if (res.status !== 422) fallos.push(`${nombre}: ${res.status} ${res.text}`);
      else if (JSON.stringify(res.body) !== JSON.stringify(inexistente.res.body)) {
        fallos.push(
          `${nombre}: el cuerpo difiere del de un id inexistente: ${res.text} / ${inexistente.res.text}`,
        );
      }
      if (filas.length > 0) fallos.push(`${nombre}: se guardó un llamado`);
    }
    exigirSinFallos(fallos);
  });

  it('un modificador de B responde lo mismo que uno inexistente, y nada se guarda', async () => {
    const { m } = await sembrado();
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const con = (modificadorIds: string[]) => [
      { productoId: m.A.carta.lomoId, modificadorIds, cantidad: 1 },
    ];
    const inexistente = await intentar(mesa!, con([randomUUID()]));
    expect([400, 422], inexistente.res.text).toContain(inexistente.res.status);
    const casos: [string, string[]][] = [
      ['el 3/4 de B', [m.B.carta.terminoIds.tresCuartos]],
      ['el 3/4 de B junto al de A', [m.A.carta.terminoIds.tresCuartos, m.B.carta.extrasIds.huevo]],
    ];
    const fallos: string[] = [];
    for (const [nombre, ids] of casos) {
      const { res, filas } = await intentar(mesa!, con(ids));
      if (res.status !== inexistente.res.status)
        fallos.push(`${nombre}: ${res.status} ${res.text}`);
      if (filas.length > 0) fallos.push(`${nombre}: se guardó un llamado`);
    }
    // El mismo caso con un modificador inexistente en lugar del de B: el cuerpo no distingue.
    const ref = await intentar(mesa!, con([m.A.carta.terminoIds.tresCuartos, randomUUID()]));
    const deB = await intentar(
      mesa!,
      con([m.A.carta.terminoIds.tresCuartos, m.B.carta.extrasIds.huevo]),
    );
    if (JSON.stringify(deB.res.body) !== JSON.stringify(ref.res.body)) {
      fallos.push(
        `el modificador de B se distingue de uno inexistente: ${deB.res.text} / ${ref.res.text}`,
      );
    }
    exigirSinFallos(fallos);
  });

  it('una línea mala entre líneas buenas rechaza todo el llamado, sin guardar nada, y señala solo la línea mala', async () => {
    const { m } = await sembrado();
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const { res, filas } = await intentar(mesa!, [
      { productoId: m.A.carta.gaseosaId, modificadorIds: [], cantidad: 1 },
      { productoId: m.B.carta.gaseosaId, modificadorIds: [], cantidad: 1 },
      { productoId: m.A.carta.gaseosaId, modificadorIds: [], cantidad: 2 },
    ]);
    expect(res.status, res.text).toBe(422);
    expect(filas).toEqual([]);
    const campos = (res.body.campos ?? []) as { campo: string }[];
    expect(campos.map((c) => c.campo)).toEqual(['lineas.1']);
    // Y la mesa sigue libre de llamados: puede mandar uno bueno.
    exigirEstado(
      await clientePublico(ctx).post(rutaDeLlamados(mesa!.codigo), llamarAlMozo()),
      201,
      'un llamado bueno después',
    );
  });
});

// ------------------------------------------------------------------------------------------------
// 15 · El id de un llamado de B con el código de A
// ------------------------------------------------------------------------------------------------
describe('criterio 15 · el id de un llamado de B usado con el código de A', () => {
  it('en el estado responde 404 igual que un id inexistente', async () => {
    const { m, sB } = await sembrado();
    const cliente = clientePublico(ctx);
    const deB = await cliente.get(`/publico/mesas/${m.A.mesa12.codigo}/llamados/${sB.pendiente}`);
    const inexistente = await cliente.get(
      `/publico/mesas/${m.A.mesa12.codigo}/llamados/${randomUUID()}`,
    );
    expect(deB.status, deB.text).toBe(404);
    expect(deB.body).toEqual(inexistente.body);
    // Control: con el código de B el mismo id sí se ve.
    exigirEstado(
      await cliente.get(`/publico/mesas/${m.B.mesa12.codigo}/llamados/${sB.pendiente}`),
      200,
      'el estado con el código de B',
    );
  });

  it('en un POST crea su propio llamado en A sin tocar ni revelar el de B', async () => {
    const { m, sB } = await sembrado();
    const cliente = clientePublico(ctx);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const antesB = await fotoDeLlamados(admin, m.B.empresaId);
    const filaBAntes = await filaComoJson(admin, 'llamado', sB.pendiente, m.B.empresaId);
    expect(filaBAntes).not.toBeNull();
    // El llamado de B es un LLAMAR_MOZO; el de A, un pedido con otro cuerpo.
    const cuerpo = pedidoDeLomo(m.A.carta, { id: sB.pendiente, nota: 'Mesa de A' });
    const res = await cliente.post(rutaDeLlamados(mesa!.codigo), cuerpo);
    exigirEstado(res, 201, 'crear en A con el id de un llamado de B');
    expect(res.body.id).toBe(sB.pendiente);
    expect(res.body.tipo).toBe('PEDIDO');
    expect(res.body.estado).toBe('PENDIENTE');
    expect(res.body.lineas).toHaveLength(1);
    // Dos filas con el mismo id, una por empresa; la de B no cambió.
    const filas = await filasDelLlamado(sB.pendiente);
    expect(filas.map((f) => f.empresa_id).sort()).toEqual([m.A.empresaId, m.B.empresaId].sort());
    expect(filas.find((f) => f.empresa_id === m.A.empresaId)!.mesa_id).toBe(mesa!.id);
    expect(await fotoDeLlamados(admin, m.B.empresaId)).toEqual(antesB);
    expect(await filaComoJson(admin, 'llamado', sB.pendiente, m.B.empresaId)).toEqual(filaBAntes);
    // El estado con cada código ve el suyo.
    const deA = await cliente.get(`/publico/mesas/${mesa!.codigo}/llamados/${sB.pendiente}`);
    exigirEstado(deA, 200, 'el estado en A');
    expect(deA.body.tipo).toBe('PEDIDO');
    const delB = await cliente.get(`/publico/mesas/${m.B.mesa12.codigo}/llamados/${sB.pendiente}`);
    exigirEstado(delB, 200, 'el estado en B');
    expect(delB.body.tipo).toBe('LLAMAR_MOZO');
    // Repetir el POST en A es una réplica del de A (no del de B).
    const replica = await cliente.post(rutaDeLlamados(mesa!.codigo), cuerpo);
    exigirEstado(replica, 201, 'la réplica en A');
    expect(replica.body).toEqual(res.body);
  });
});

// ------------------------------------------------------------------------------------------------
// 16 · CORS
// ------------------------------------------------------------------------------------------------
describe('criterio 16 · CORS: el origen de la carta web solo vale en /publico/*', () => {
  const cabecera = (res: { headers: Record<string, unknown> }, nombre: string): string =>
    String(res.headers[nombre] ?? '');

  const PREFLIGHT_PUBLICOS: [string, string, string][] = [
    ['/publico/cartas/x-empresa', 'GET', 'if-none-match'],
    ['/publico/cartas/x-empresa/x-sucursal', 'GET', 'if-none-match'],
    ['/publico/cartas/x-empresa/x-sucursal/disponibilidad', 'GET', 'if-none-match'],
    ['/publico/mesas/AAAAAAAAAAAAAAAAAAAAAA', 'GET', 'content-type'],
    ['/publico/mesas/AAAAAAAAAAAAAAAAAAAAAA/llamados', 'POST', 'content-type'],
    [`/publico/mesas/AAAAAAAAAAAAAAAAAAAAAA/llamados/${randomUUID()}`, 'GET', 'content-type'],
  ];

  it.each(PREFLIGHT_PUBLICOS)(
    'el preflight de %s (%s) desde el origen de la carta lo permite, con sus cabeceras y sin credenciales',
    async (ruta, metodo, cabeceras) => {
      const res = await clientePublico(ctx)
        .conOrigen(CARTA_WEB_URL)
        .options(ruta)
        .set('Access-Control-Request-Method', metodo)
        .set('Access-Control-Request-Headers', cabeceras);
      expect([200, 204], res.text).toContain(res.status);
      expect(cabecera(res, 'access-control-allow-origin')).toBe(CARTA_WEB_URL);
      const metodos = cabecera(res, 'access-control-allow-methods').toUpperCase();
      for (const permitido of ['GET', 'POST', 'OPTIONS']) expect(metodos).toContain(permitido);
      for (const ajeno of ['PUT', 'PATCH', 'DELETE']) expect(metodos).not.toContain(ajeno);
      const permitidas = cabecera(res, 'access-control-allow-headers').toLowerCase();
      expect(permitidas).toContain('content-type');
      expect(permitidas).toContain('if-none-match');
      expect(cabecera(res, 'access-control-allow-credentials')).not.toBe('true');
    },
  );

  it('una respuesta real a una petición del origen de la carta lleva el origen y expone ETag y Retry-After', async () => {
    const { m } = await sembrado();
    const cliente = clientePublico(ctx).conOrigen(CARTA_WEB_URL);
    for (const ruta of [
      `/publico/cartas/${m.A.slug}`,
      `/publico/cartas/${m.A.slug}/${m.A.slugS1}`,
      `/publico/cartas/${m.A.slug}/${m.A.slugS1}/disponibilidad`,
      `/publico/mesas/${m.A.mesa12.codigo}`,
    ]) {
      const res = await cliente.get(ruta);
      exigirEstado(res, 200, ruta);
      expect(cabecera(res, 'access-control-allow-origin'), ruta).toBe(CARTA_WEB_URL);
      const expone = cabecera(res, 'access-control-expose-headers').toLowerCase();
      expect(expone, ruta).toContain('etag');
      expect(expone, ruta).toContain('retry-after');
      expect(cabecera(res, 'access-control-allow-credentials'), ruta).not.toBe('true');
    }
    // También el 404 público y el POST.
    const noExiste = await cliente.get('/publico/mesas/AAAAAAAAAAAAAAAAAAAAAA');
    expect(noExiste.status).toBe(404);
    expect(cabecera(noExiste, 'access-control-allow-origin')).toBe(CARTA_WEB_URL);
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const post = await cliente.post(rutaDeLlamados(mesa!.codigo), llamarAlMozo());
    exigirEstado(post, 201, 'el POST desde el origen de la carta');
    expect(cabecera(post, 'access-control-allow-origin')).toBe(CARTA_WEB_URL);
  });

  it('un origen que no es el de la carta ni uno permitido no recibe permiso ni en /publico/*', async () => {
    const { m } = await sembrado();
    for (const origen of ['https://malo.example', `${CARTA_WEB_URL}.malo.example`, 'null']) {
      const cliente = clientePublico(ctx).conOrigen(origen);
      const pre = await cliente
        .options(`/publico/mesas/${m.A.mesa12.codigo}/llamados`)
        .set('Access-Control-Request-Method', 'POST');
      expect(cabecera(pre, 'access-control-allow-origin'), origen).not.toBe(origen);
      const res = await cliente.get(`/publico/cartas/${m.A.slug}`);
      expect(cabecera(res, 'access-control-allow-origin'), origen).not.toBe(origen);
    }
  });

  it('los orígenes de ORIGENES_PERMITIDOS siguen aceptados en /publico/* y en las rutas con sesión', async () => {
    const { m } = await sembrado();
    const cliente = clientePublico(ctx).conOrigen(ORIGEN_DE_LA_PWA);
    const publico = await cliente.get(`/publico/cartas/${m.A.slug}`);
    exigirEstado(publico, 200, 'la carta desde la PWA');
    expect(cabecera(publico, 'access-control-allow-origin')).toBe(ORIGEN_DE_LA_PWA);
    const pre = await cliente.options('/sesion').set('Access-Control-Request-Method', 'GET');
    expect(cabecera(pre, 'access-control-allow-origin')).toBe(ORIGEN_DE_LA_PWA);
  });

  const RUTAS_CON_SESION: [string, string][] = [
    ['/sesion', 'GET'],
    ['/sesion', 'DELETE'],
    ['/llamados', 'GET'],
    [`/llamados/${randomUUID()}`, 'GET'],
    [`/llamados/${randomUUID()}/atencion`, 'POST'],
    [`/llamados/${randomUUID()}/paso-a-cuenta`, 'POST'],
    [`/llamados/${randomUUID()}/descarte`, 'POST'],
    ['/carta-web', 'GET'],
    ['/carta-web', 'PUT'],
    ['/carta-web/logo', 'PUT'],
    [`/carta-web/sucursales/${randomUUID()}`, 'PUT'],
    [`/sucursales/${randomUUID()}/qr-mesas`, 'GET'],
    [`/sucursales/${randomUUID()}/qr-mesas`, 'POST'],
    [`/sucursales/${randomUUID()}/mesas/${randomUUID()}/qr`, 'POST'],
    ['/salon', 'GET'],
    ['/ordenes', 'POST'],
    ['/carta/productos', 'GET'],
    ['/sucursales', 'GET'],
    ['/usuarios', 'GET'],
    ['/plataforma/empresas', 'GET'],
    ['/health', 'GET'],
  ];

  it.each(RUTAS_CON_SESION)(
    'el origen de la carta no recibe permiso de CORS en %s (%s), ni en el preflight ni en la respuesta',
    async (ruta, metodo) => {
      const cliente = clientePublico(ctx).conOrigen(CARTA_WEB_URL);
      const pre = await cliente
        .options(ruta)
        .set('Access-Control-Request-Method', metodo)
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(cabecera(pre, 'access-control-allow-origin'), `preflight de ${ruta}`).not.toBe(
        CARTA_WEB_URL,
      );
      expect(cabecera(pre, 'access-control-allow-origin'), `preflight de ${ruta}`).not.toBe('*');
      const real = metodo === 'GET' ? await cliente.get(ruta) : await cliente.post(ruta, {});
      expect(cabecera(real, 'access-control-allow-origin'), `respuesta de ${ruta}`).not.toBe(
        CARTA_WEB_URL,
      );
      expect(cabecera(real, 'access-control-allow-origin'), `respuesta de ${ruta}`).not.toBe('*');
    },
  );
});

// ------------------------------------------------------------------------------------------------
// 66 · Ids de B en rutas autenticadas
// ------------------------------------------------------------------------------------------------
describe('criterio 66 · un id de B en una ruta autenticada responde 404 igual que un id inexistente', () => {
  it('los llamados: detalle, atención, paso a la cuenta y descarte', async () => {
    const { m, sB } = await sembrado();
    const mozoA = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    const antesB = await fotoDeLlamados(admin, m.B.empresaId);
    const antesA = await fotoDeLlamados(admin, m.A.empresaId);
    const rutas = (id: string): [string, () => ReturnType<typeof llamar>][] => [
      ['GET /llamados/:id', () => llamar(ctx, mozoA, { metodo: 'get', ruta: `/llamados/${id}` })],
      [
        'POST atencion',
        () =>
          llamar(ctx, mozoA, {
            metodo: 'post',
            ruta: `/llamados/${id}/atencion`,
            cuerpo: { ordenId: randomUUID(), comensales: 2 },
            cabeceras: clave(),
          }),
      ],
      [
        'POST paso-a-cuenta',
        () =>
          llamar(ctx, mozoA, {
            metodo: 'post',
            ruta: `/llamados/${id}/paso-a-cuenta`,
            cuerpo: { lineas: [{ posicion: 0, cantidad: 1 }] },
            cabeceras: clave(),
          }),
      ],
      [
        'POST descarte',
        () =>
          llamar(ctx, mozoA, {
            metodo: 'post',
            ruta: `/llamados/${id}/descarte`,
            cuerpo: { motivo: 'Pedido falso' },
            cabeceras: clave(),
          }),
      ],
    ];
    const fallos: string[] = [];
    for (const idDeB of [sB.pendiente, sB.descartado]) {
      for (const [nombre, hacer] of rutas(idDeB)) {
        const referencia = await rutas(randomUUID()).find(([n]) => n === nombre)![1]();
        const res = await hacer();
        if (res.status !== 404) fallos.push(`${nombre} con un id de B: ${res.status} ${res.text}`);
        else if (JSON.stringify(res.body) !== JSON.stringify(referencia.body)) {
          fallos.push(`${nombre}: el 404 con un id de B difiere del de un id inexistente`);
        }
        if (referencia.status !== 404) {
          fallos.push(`${nombre} con un id inexistente: ${referencia.status} ${referencia.text}`);
        }
      }
    }
    exigirSinFallos(fallos);
    expect(await fotoDeLlamados(admin, m.B.empresaId)).toEqual(antesB);
    expect(await fotoDeLlamados(admin, m.A.empresaId)).toEqual(antesA);
  });

  it('la configuración y los QR: sucursal de B, mesa de B o sucursal de A con una mesa de B', async () => {
    const { m } = await sembrado();
    const token = m.A.tokenAdmin;
    const antesCartaB = await filaCartaWeb(m.B.empresaId);
    const antesQrB = (
      await admin.query(
        `SELECT to_jsonb(t) AS f FROM mesa_qr t WHERE empresa_id = $1 ORDER BY id::text`,
        [m.B.empresaId],
      )
    ).rows;
    const antesSucursalesB = (
      await admin.query(
        `SELECT to_jsonb(t) AS f FROM carta_web_sucursal t WHERE empresa_id = $1 ORDER BY id::text`,
        [m.B.empresaId],
      )
    ).rows;
    const casos: [string, (sucursal: string, mesa: string) => Parameters<typeof llamar>[2]][] = [
      [
        'PUT /carta-web/sucursales/:id',
        (s) => ({
          metodo: 'put',
          ruta: `/carta-web/sucursales/${s}`,
          cuerpo: { slug: 'tomada-de-b', publicada: true },
        }),
      ],
      [
        'GET /sucursales/:id/qr-mesas',
        (s) => ({ metodo: 'get', ruta: `/sucursales/${s}/qr-mesas` }),
      ],
      [
        'POST /sucursales/:id/qr-mesas',
        (s) => ({ metodo: 'post', ruta: `/sucursales/${s}/qr-mesas` }),
      ],
      [
        'POST /sucursales/:id/mesas/:mesaId/qr',
        (s, mesa) => ({
          metodo: 'post',
          ruta: `/sucursales/${s}/mesas/${mesa}/qr`,
          cabeceras: clave(),
        }),
      ],
    ];
    const fallos: string[] = [];
    for (const [nombre, armar] of casos) {
      const referencia = await llamar(ctx, token, armar(randomUUID(), randomUUID()));
      const intentos: [string, string, string][] = [
        ['sucursal de B', m.B.S1, m.B.mesa4.id],
        ['sucursal de B y su mesa', m.B.S2, m.B.mesaS2.id],
      ];
      if (nombre.includes(':mesaId'))
        intentos.push(['sucursal de A con una mesa de B', m.A.S1, m.B.mesa4.id]);
      for (const [descripcion, sucursal, mesa] of intentos) {
        const res = await llamar(ctx, token, armar(sucursal, mesa));
        if (res.status !== 404)
          fallos.push(`${nombre} (${descripcion}): ${res.status} ${res.text}`);
        else if (JSON.stringify(res.body) !== JSON.stringify(referencia.body)) {
          fallos.push(`${nombre} (${descripcion}): el 404 difiere del de un id inexistente`);
        }
      }
      if (referencia.status !== 404) {
        fallos.push(`${nombre} con ids inexistentes: ${referencia.status} ${referencia.text}`);
      }
    }
    exigirSinFallos(fallos);
    expect(await filaCartaWeb(m.B.empresaId)).toEqual(antesCartaB);
    expect(
      (
        await admin.query(
          `SELECT to_jsonb(t) AS f FROM mesa_qr t WHERE empresa_id = $1 ORDER BY id::text`,
          [m.B.empresaId],
        )
      ).rows,
    ).toEqual(antesQrB);
    expect(
      (
        await admin.query(
          `SELECT to_jsonb(t) AS f FROM carta_web_sucursal t WHERE empresa_id = $1 ORDER BY id::text`,
          [m.B.empresaId],
        )
      ).rows,
    ).toEqual(antesSucursalesB);
  });

  async function filaCartaWeb(empresaId: string) {
    return (
      await admin.query(`SELECT to_jsonb(t) AS f FROM carta_web t WHERE empresa_id = $1`, [
        empresaId,
      ])
    ).rows;
  }

  it('el ordenId de la atención es único por empresa: el mismo UUID de una orden de B crea la orden de A y la de B no cambia', async () => {
    const { m, sB } = await sembrado();
    const mozoA = (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena;
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const llamadoId = randomUUID();
    await crearLlamadoOk(
      clientePublico(ctx),
      mesa!.codigo,
      pedidoDeLomo(m.A.carta, { id: llamadoId }),
    );
    const ordenB = await filaComoJson(admin, 'orden', sB.ordenId, m.B.empresaId);
    expect(ordenB, 'la orden de B existe').not.toBeNull();
    const res = await atenderLlamado(ctx, mozoA, llamadoId, { ordenId: sB.ordenId, comensales: 3 });
    expect(res.body.mesaAbierta).toBe(true);
    expect(res.body.ordenId).toBe(sB.ordenId);
    const propia = await filaComoJson(admin, 'orden', sB.ordenId, m.A.empresaId);
    expect(propia, 'la orden de A con ese id').not.toBeNull();
    expect(propia!.comensales).toBe(3);
    expect(await filaComoJson(admin, 'orden', sB.ordenId, m.B.empresaId)).toEqual(ordenB);
  });

  it('el id de un llamado propio de A puede ser el de una orden de B: ningún id de cliente se cruza', async () => {
    const { m, sB } = await sembrado();
    const [mesa] = await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 1);
    const res = await clientePublico(ctx).post(
      rutaDeLlamados(mesa!.codigo),
      llamarAlMozo(sB.ordenId),
    );
    exigirEstado(res, 201, 'un llamado de A con el id de una orden de B');
    expect(res.body.id).toBe(sB.ordenId);
  });
});

// ------------------------------------------------------------------------------------------------
// 67 · Concurrencia con un pool de 2 conexiones
// ------------------------------------------------------------------------------------------------
describe('criterio 67 · 100 peticiones simultáneas que alternan A y B con un pool de 2 conexiones', () => {
  interface Tarea {
    empresa: 'A' | 'B';
    tipo: 'carta' | 'crear' | 'estado' | 'lista';
    mesaId?: string;
    llamadoId?: string;
    ejecutar: () => Promise<{ status: number; body: any; text: string }>;
  }

  it('devuelven y cambian solo datos de su empresa, y cada evento llega solo a su sala', async () => {
    const { m } = await sembrado();
    const empresas: ['A' | 'B', EmpresaDelMundo][] = [
      ['A', m.A],
      ['B', m.B],
    ];
    // Una mesa por cada POST (uno pendiente por mesa) y una IP por cliente (el límite es por conexión).
    const mesas = {
      A: await mesasNuevas(ctx, m.A.tokenAdmin, m.A.S1, 12),
      B: await mesasNuevas(ctx, m.B.tokenAdmin, m.B.S1, 12),
    };
    const tokens = {
      A: (await sesiones(ctx, m.A.mozo, m.A.S1)).contrasena,
      B: (await sesiones(ctx, m.B.mozo, m.B.S1)).contrasena,
    };
    // Un llamado previo por empresa, para leer su estado.
    const previos: Record<'A' | 'B', string> = { A: randomUUID(), B: randomUUID() };
    const mesaDelPrevio = { A: m.A.mesa12, B: m.B.mesa12 };
    for (const [clave2, empresa] of empresas) {
      void empresa;
      await crearLlamadoOk(
        clientePublico(ctx),
        mesaDelPrevio[clave2].codigo,
        llamarAlMozo(previos[clave2]),
        'el llamado previo',
      );
    }
    await asentar();
    ctx.publicador.limpiar();

    const tareas: Tarea[] = [];
    const siguienteMesa = { A: 0, B: 0 };
    for (let i = 0; i < 100; i++) {
      const [clave2, empresa] = empresas[i % 2]!;
      const ronda = Math.floor(i / 2);
      const tipo = (['carta', 'crear', 'estado', 'lista'] as const)[ronda % 4]!;
      if (tipo === 'carta') {
        tareas.push({
          empresa: clave2,
          tipo,
          ejecutar: () =>
            clientePublico(ctx).get(`/publico/cartas/${empresa.slug}/${empresa.slugS1}`) as never,
        });
      } else if (tipo === 'crear' && siguienteMesa[clave2] < mesas[clave2].length) {
        const mesa = mesas[clave2][siguienteMesa[clave2]++]!;
        const id = randomUUID();
        const cuerpo = ronda % 8 === 1 ? pedidoDeLomo(empresa.carta, { id }) : llamarAlMozo(id);
        tareas.push({
          empresa: clave2,
          tipo,
          mesaId: mesa.id,
          llamadoId: id,
          ejecutar: () => clientePublico(ctx).post(rutaDeLlamados(mesa.codigo), cuerpo) as never,
        });
      } else if (tipo === 'lista') {
        tareas.push({
          empresa: clave2,
          tipo,
          ejecutar: () =>
            llamar(ctx, tokens[clave2], { metodo: 'get', ruta: '/llamados' }) as never,
        });
      } else {
        tareas.push({
          empresa: clave2,
          tipo: 'estado',
          llamadoId: previos[clave2],
          ejecutar: () =>
            clientePublico(ctx).get(
              `/publico/mesas/${mesaDelPrevio[clave2].codigo}/llamados/${previos[clave2]}`,
            ) as never,
        });
      }
    }
    expect(tareas).toHaveLength(100);
    expect(tareas.filter((t) => t.tipo === 'crear').length).toBeGreaterThanOrEqual(20);

    const respuestas = await Promise.all(tareas.map((t) => t.ejecutar()));
    await asentar();

    const fallos: string[] = [];
    const creados = { A: new Set<string>(), B: new Set<string>() };
    const mesasDe = { A: new Set(mesas.A.map((x) => x.id)), B: new Set(mesas.B.map((x) => x.id)) };
    const productosDe = {
      A: new Set([m.A.carta.lomoId, m.A.carta.comboId, m.A.carta.gaseosaId]),
      B: new Set([m.B.carta.lomoId, m.B.carta.comboId, m.B.carta.gaseosaId]),
    };
    const nombreDe = { A: m.A.nombreCarta, B: m.B.nombreCarta };
    tareas.forEach((t, i) => {
      const r = respuestas[i]!;
      const otra = t.empresa === 'A' ? 'B' : 'A';
      switch (t.tipo) {
        case 'carta': {
          if (r.status !== 200) return void fallos.push(`carta ${t.empresa}: ${r.status}`);
          const ids = (r.body.familias as { productos: { id: string }[] }[]).flatMap((f) =>
            f.productos.map((p) => p.id),
          );
          if (r.body.empresa.nombre !== nombreDe[t.empresa]) {
            fallos.push(`carta ${t.empresa}: trae la empresa ${r.body.empresa.nombre}`);
          }
          for (const id of ids) {
            if (!productosDe[t.empresa].has(id) || productosDe[otra].has(id)) {
              fallos.push(`carta ${t.empresa}: trae el producto ${id}`);
            }
          }
          break;
        }
        case 'crear':
          if (r.status !== 201) fallos.push(`crear ${t.empresa}: ${r.status} ${r.text}`);
          else if (r.body.id !== t.llamadoId) fallos.push(`crear ${t.empresa}: otro id`);
          else creados[t.empresa].add(t.llamadoId!);
          break;
        case 'estado':
          if (r.status !== 200) fallos.push(`estado ${t.empresa}: ${r.status}`);
          else if (r.body.id !== t.llamadoId) fallos.push(`estado ${t.empresa}: otro llamado`);
          break;
        case 'lista':
          if (r.status !== 200) fallos.push(`lista ${t.empresa}: ${r.status} ${r.text}`);
          break;
      }
    });
    exigirSinFallos(fallos);

    // Las filas: cada llamado creado quedó en la empresa y en la mesa correctas.
    const todos = [...creados.A, ...creados.B];
    const { rows } = await admin.query<{ id: string; empresa_id: string; mesa_id: string }>(
      `SELECT id, empresa_id, mesa_id FROM llamado WHERE id = ANY($1::uuid[])`,
      [todos],
    );
    expect(rows).toHaveLength(todos.length);
    for (const f of rows) {
      const clave2 = creados.A.has(f.id) ? 'A' : 'B';
      const empresa = clave2 === 'A' ? m.A : m.B;
      if (f.empresa_id !== empresa.empresaId) fallos.push(`${f.id}: quedó en otra empresa`);
      if (!mesasDe[clave2].has(f.mesa_id)) fallos.push(`${f.id}: quedó en una mesa ajena`);
    }
    exigirSinFallos(fallos);

    // Las listas: solo llamados de su empresa.
    const idsPorEmpresa = {
      A: new Set(
        (
          await admin.query<{ id: string }>(`SELECT id FROM llamado WHERE empresa_id = $1`, [
            m.A.empresaId,
          ])
        ).rows.map((f) => f.id),
      ),
      B: new Set(
        (
          await admin.query<{ id: string }>(`SELECT id FROM llamado WHERE empresa_id = $1`, [
            m.B.empresaId,
          ])
        ).rows.map((f) => f.id),
      ),
    };
    tareas.forEach((t, i) => {
      if (t.tipo !== 'lista') return;
      const otra = t.empresa === 'A' ? 'B' : 'A';
      const lista = (respuestas[i]!.body.llamados ?? []) as { id: string; mesa: { id: string } }[];
      for (const l of lista) {
        if (!idsPorEmpresa[t.empresa].has(l.id)) fallos.push(`lista ${t.empresa}: trae ${l.id}`);
        if (idsPorEmpresa[otra].has(l.id) && !idsPorEmpresa[t.empresa].has(l.id)) {
          fallos.push(`lista ${t.empresa}: trae un llamado de ${otra}`);
        }
      }
    });
    exigirSinFallos(fallos);

    // Los eventos: uno por llamado creado, en la sala de la sucursal de su empresa.
    const nuevos = ctx.publicador
      .eventos()
      .filter((e) => (e as { nombre: string }).nombre === 'llamado.nuevo') as unknown as {
      empresaId: string;
      sala: { tipo: string; sucursalId?: string };
      datos: { llamadoId: string };
    }[];
    expect(nuevos).toHaveLength(todos.length);
    for (const e of nuevos) {
      const clave2 = creados.A.has(e.datos.llamadoId)
        ? 'A'
        : creados.B.has(e.datos.llamadoId)
          ? 'B'
          : null;
      if (clave2 === null) {
        fallos.push(`evento de un llamado desconocido ${e.datos.llamadoId}`);
        continue;
      }
      const empresa = clave2 === 'A' ? m.A : m.B;
      if (e.empresaId !== empresa.empresaId)
        fallos.push(`${e.datos.llamadoId}: evento con la empresa ${e.empresaId}`);
      if (e.sala.tipo !== 'sucursal' || e.sala.sucursalId !== empresa.S1) {
        fallos.push(`${e.datos.llamadoId}: evento en la sala ${JSON.stringify(e.sala)}`);
      }
    }
    exigirSinFallos(fallos);
    expect(await cuantosLlamados(m.A.empresaId)).toBeGreaterThan(creados.A.size);
    void postConClave;
  });
});
