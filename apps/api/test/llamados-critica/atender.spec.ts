// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P2 · La lista de llamados y atender · Criterios 39 a 45. La API real con `RelojManual`, `PublicadorEnMemoria`
// e `InventarioDePrueba`, dos empresas (A con S1 y S2, y B), la carta de ejemplo de 004, la carta web publicada
// por sus rutas, las mesas creadas por las rutas de 004 y las personas creadas con `POST /usuarios`.
//
// Cubre: la lista (pendientes vigentes, atendidos sin cerrar, recientes, orden, sucursal activa, ETag y 304) y el
// detalle con la revisión (producto agotado, precio cambiado, componente) (39, 40); atender con la mesa
// ocupada y libre (abre la orden con `ordenId` y `comensales`, el que atiende queda como responsable,
// `salon.cambio` y `orden.cambio`), `MESA_LIBRE`, `PEDIR_CUENTA`, la apertura concurrente por otra persona,
// el soporte y la mesa inactiva (41, 42); dos atenciones simultáneas (`LLAMADO_TOMADO`), la misma persona otra
// vez y la réplica por clave (43); vencido y cerrado, otra sucursal y B (44); y `llamado.cambio` (45).
import {
  atencionRespuestaSchema,
  eventoLlamadoCambioSchema,
  llamadoDetalleSchema,
  llamadosRespuestaSchema,
} from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { agotar, reactivar } from '../salon-critica/fabrica-p2';
import {
  HORA_DE_SERVICIO,
  MINUTO,
  abriendo,
  abrirMesa,
  arrancarLlamados,
  atenderLlamado,
  atenderOk,
  cambiarProducto,
  clave,
  conteoDePedidos,
  crearLlamado,
  cuerpoLlamarMozo,
  cuerpoPedido,
  cuerpoPedirCuenta,
  descartarOk,
  detalleDeLlamado,
  esperarError,
  eventosDeLlamado,
  eventosDePedidos,
  eventosPublicados,
  exigirEstado,
  filaLlamado,
  lineaDe,
  lineasDe,
  lineasDelPedido,
  limpiarRegistros,
  listaDeLlamados,
  llamar,
  mesaConCodigo,
  mesaEnElMapa,
  mesasConCodigo,
  nombreDe,
  ordenesAbiertasDeLaMesa,
  pasarOk,
  ponerActiva,
  prepararEscenarioLlamados,
  productoPropio,
  renovarSesiones,
  sinIds,
  type AppLlamados,
  type EscenarioLlamados,
  type Lugar,
  type MesaLlamados,
} from './fabrica-llamados';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;
let L: ReturnType<typeof lineasDe>;

const t = () => esc.token;
const A = () => esc.e.A;
const mozo = () => A().mozo;
const nuevaMesa = (lugar: Lugar = 'S1'): Promise<MesaLlamados> => mesaConCodigo(ctx, esc, lugar);
const iso = () => ctx.reloj.ahora().toISOString();

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

type Fila = { id: string; estado: string; mesa: { id: string; nombre: string } } & Record<
  string,
  unknown
>;

async function filasDeLaLista(token: string): Promise<Fila[]> {
  const res = await listaDeLlamados(ctx, token);
  exigirEstado(res, 200, 'GET /llamados');
  return llamadosRespuestaSchema.parse(res.body).llamados as unknown as Fila[];
}

async function detalle(token: string, id: string) {
  const res = await detalleDeLlamado(ctx, token, id);
  exigirEstado(res, 200, 'GET /llamados/:id');
  return llamadoDetalleSchema.parse(res.body);
}

async function estadoGuardado(mesa: MesaLlamados, id: string): Promise<string> {
  return (await filaLlamado(admin, mesa.empresaId, id))!.estado;
}

// ===================================================================================================
// Criterio 39 · la lista
// ===================================================================================================

describe('criterio 39 · GET /llamados', () => {
  it('trae los pendientes vigentes de la sucursal activa con la forma del contrato y la hora de la API', async () => {
    const [m1, m2, m3] = await mesasConCodigo(ctx, esc, 3);
    const nota = 'Sin picante';
    const pedido = await crearLlamado(ctx, m1!, cuerpoPedido(lineasDelPedido(esc), { nota }));
    const aviso = await crearLlamado(ctx, m2!, cuerpoLlamarMozo());
    const cuenta = await crearLlamado(ctx, m3!, cuerpoPedirCuenta());

    const res = await listaDeLlamados(ctx, t().mozo);
    exigirEstado(res, 200, 'GET /llamados');
    const cuerpo = llamadosRespuestaSchema.parse(res.body);
    expect(cuerpo.ahora).toBe(iso());
    const filas = cuerpo.llamados;
    const delPedido = filas.find((f) => f.id === pedido.id)!;
    expect(delPedido).toMatchObject({
      tipo: 'PEDIDO',
      estado: 'PENDIENTE',
      mesa: { id: m1!.id, nombre: m1!.nombre },
      creadoEn: pedido.respuesta.creadoEn,
      venceEn: pedido.respuesta.venceEn,
      unidades: 3,
      total: '70.00',
      nota,
      destinatarios: null,
      atendidoPor: null,
      atendidoEn: null,
      cerradoPor: null,
      cerradoEn: null,
      ordenId: null,
    });
    expect(filas.find((f) => f.id === aviso.id)).toMatchObject({
      tipo: 'LLAMAR_MOZO',
      estado: 'PENDIENTE',
      unidades: 0,
      total: null,
      nota: null,
    });
    expect(filas.find((f) => f.id === cuenta.id)).toMatchObject({
      tipo: 'PEDIR_CUENTA',
      estado: 'PENDIENTE',
    });
  });

  it('con la mesa ocupada, destinatarios es el mozo responsable y ordenId la orden abierta', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo, { mozoId: esc.mozo2.id });
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const fila = (await filasDeLaLista(t().mozo)).find((f) => f.id === creado.id)!;
    expect(fila).toMatchObject({ destinatarios: [esc.mozo2.id], ordenId });
  });

  it('los pendientes van primero y por antigüedad (el más viejo, primero), antes que los atendidos y los recientes', async () => {
    const [m1, m2, m3, m4, m5] = await mesasConCodigo(ctx, esc, 5);
    const cerrado = await crearLlamado(ctx, m4!, cuerpoLlamarMozo());
    await descartarOk(ctx, t().mozo, cerrado.id);
    const atendido = await crearLlamado(ctx, m5!, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, atendido.id, abriendo());
    ctx.reloj.avanzar(MINUTO);
    const p1 = await crearLlamado(ctx, m1!, cuerpoLlamarMozo());
    ctx.reloj.avanzar(MINUTO);
    const p2 = await crearLlamado(ctx, m2!, cuerpoPedirCuenta());
    ctx.reloj.avanzar(MINUTO);
    const p3 = await crearLlamado(ctx, m3!, cuerpoLlamarMozo());

    const ids = (await filasDeLaLista(t().mozo)).map((f) => f.id);
    const posicion = (id: string) => ids.indexOf(id);
    for (const id of [p1.id, p2.id, p3.id, atendido.id, cerrado.id])
      expect(posicion(id)).toBeGreaterThanOrEqual(0);
    expect(posicion(p1.id)).toBeLessThan(posicion(p2.id));
    expect(posicion(p2.id)).toBeLessThan(posicion(p3.id));
    for (const noPendiente of [atendido.id, cerrado.id]) {
      expect(posicion(p3.id)).toBeLessThan(posicion(noPendiente));
    }
  });

  it('un PEDIDO atendido sin cerrar sigue en la lista; un LLAMAR_MOZO o PEDIR_CUENTA atendido ya no', async () => {
    const [m1, m2, m3] = await mesasConCodigo(ctx, esc, 3);
    const pedido = await crearLlamado(ctx, m1!, cuerpoPedido(lineasDelPedido(esc)));
    const aviso = await crearLlamado(ctx, m2!, cuerpoLlamarMozo());
    const cuenta = await crearLlamado(ctx, m3!, cuerpoPedirCuenta());
    for (const c of [pedido, aviso, cuenta]) await atenderOk(ctx, t().mozo, c.id, abriendo());
    ctx.reloj.avanzar(20 * MINUTO); // pasa el vencimiento de 15 minutos: un atendido no vence

    const filas = await filasDeLaLista(t().mozo);
    expect(filas.find((f) => f.id === pedido.id)).toMatchObject({
      estado: 'ATENDIDO',
      atendidoPor: { id: mozo().id, nombre: nombreDe(mozo()) },
    });
    expect(filas.some((f) => f.id === aviso.id)).toBe(false);
    expect(filas.some((f) => f.id === cuenta.id)).toBe(false);
  });

  it('un pendiente vencido sale de los pendientes cuando llega su hora y se ve como VENCIDO, con el ahora de la API', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO - 1);
    expect((await filasDeLaLista(t().mozo)).find((f) => f.id === creado.id)!.estado).toBe(
      'PENDIENTE',
    );
    ctx.reloj.avanzar(1);
    const res = await listaDeLlamados(ctx, t().mozo);
    expect(res.body.ahora).toBe(iso());
    const fila = (res.body.llamados as Fila[]).find((f) => f.id === creado.id);
    expect(fila?.estado).toBe('VENCIDO');
  });

  it('los recientes (pasados, descartados, vencidos) aparecen durante 60 minutos; un pasado y un descartado ya no a los 61', async () => {
    const [mp, md, mv] = await mesasConCodigo(ctx, esc, 3);
    const pasado = await crearLlamado(ctx, mp!, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, pasado.id, abriendo());
    await pasarOk(ctx, t().mozo, pasado.id, [{ posicion: 0, cantidad: 1 }]);
    const descartado = await crearLlamado(ctx, md!, cuerpoLlamarMozo());
    await descartarOk(ctx, t().mozo, descartado.id, { motivo: 'Pedido falso' });
    const vencido = await crearLlamado(ctx, mv!, cuerpoLlamarMozo());

    ctx.reloj.avanzar(25 * MINUTO);
    let filas = await filasDeLaLista(t().mozo);
    expect(filas.find((f) => f.id === pasado.id)?.estado).toBe('PASADO_A_CUENTA');
    expect(filas.find((f) => f.id === descartado.id)?.estado).toBe('DESCARTADO');
    expect(filas.find((f) => f.id === vencido.id)?.estado).toBe('VENCIDO');

    ctx.reloj.avanzar(25 * MINUTO); // 50 minutos
    await filasDeLaLista(t().mozo);
    ctx.reloj.avanzar(9 * MINUTO); // 59 minutos
    filas = await filasDeLaLista(t().mozo);
    expect(filas.some((f) => f.id === pasado.id)).toBe(true);
    expect(filas.some((f) => f.id === descartado.id)).toBe(true);

    ctx.reloj.avanzar(2 * MINUTO); // 61 minutos
    filas = await filasDeLaLista(t().mozo);
    expect(filas.some((f) => f.id === pasado.id)).toBe(false);
    expect(filas.some((f) => f.id === descartado.id)).toBe(false);

    ctx.reloj.avanzar(15 * MINUTO); // 76 minutos: el vencido (que venció a los 15) también salió
    filas = await filasDeLaLista(t().mozo);
    expect(filas.some((f) => f.id === vencido.id)).toBe(false);
  });

  it('los recientes son hasta 30: los más nuevos entran y el más viejo queda fuera', async () => {
    const mesas = await mesasConCodigo(ctx, esc, 31);
    // Tres horas después, para que ningún cierre de otra prueba sea más nuevo que los de esta.
    const inicio = ctx.reloj.ahora().getTime() + 3 * 60 * MINUTO;
    ctx.reloj.fijar(inicio);
    await renovarSesiones(ctx, esc);
    const cerrados: string[] = [];
    for (const [i, mesa] of mesas.entries()) {
      ctx.reloj.fijar(inicio + (i + 1) * MINUTO);
      const c = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
      await descartarOk(ctx, t().mozo, c.id, { motivo: 'Prueba' });
      cerrados.push(c.id);
    }
    const filas = await filasDeLaLista(t().mozo);
    const recientes = filas.filter((f) =>
      ['PASADO_A_CUENTA', 'DESCARTADO', 'VENCIDO'].includes(f.estado),
    );
    expect(recientes).toHaveLength(30);
    const ids = new Set(recientes.map((f) => f.id));
    expect(ids.has(cerrados[0]!)).toBe(false);
    for (const id of cerrados.slice(1)) expect(ids.has(id)).toBe(true);
  });

  it('es de la sucursal activa: el mozo de S2 ve los de S2 y no los de S1, y el de B no ve ninguno de A', async () => {
    const mesaS1 = await nuevaMesa();
    const mesaS2 = await nuevaMesa('S2');
    const deS1 = await crearLlamado(ctx, mesaS1, cuerpoLlamarMozo());
    const deS2 = await crearLlamado(ctx, mesaS2, cuerpoLlamarMozo());
    const idsS1 = (await filasDeLaLista(t().mozo)).map((f) => f.id);
    const idsS2 = (await filasDeLaLista(t().mozoS2)).map((f) => f.id);
    const idsB = (await filasDeLaLista(t().mozoB)).map((f) => f.id);
    expect(idsS1).toContain(deS1.id);
    expect(idsS1).not.toContain(deS2.id);
    expect(idsS2).toContain(deS2.id);
    expect(idsS2).not.toContain(deS1.id);
    expect(idsB).not.toContain(deS1.id);
    expect(idsB).not.toContain(deS2.id);
  });

  it('lleva ETag y responde 304 con If-None-Match; un llamado nuevo cambia el ETag', async () => {
    const primera = await listaDeLlamados(ctx, t().mozo);
    exigirEstado(primera, 200, 'GET /llamados');
    const etag = primera.headers.etag as string;
    expect(etag).toBeTruthy();
    const igual = await listaDeLlamados(ctx, t().mozo, { 'If-None-Match': etag });
    expect(igual.status).toBe(304);

    const mesa = await nuevaMesa();
    await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const cambiada = await listaDeLlamados(ctx, t().mozo, { 'If-None-Match': etag });
    exigirEstado(cambiada, 200, 'GET /llamados tras un llamado nuevo');
    expect(cambiada.headers.etag).not.toBe(etag);
  });
});

// ===================================================================================================
// Criterio 40 · el detalle con la revisión
// ===================================================================================================

describe('criterio 40 · GET /llamados/:id', () => {
  it('trae las líneas con posición, modificadores, precio del cliente y revisión, y los totales', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(
      ctx,
      mesa,
      cuerpoPedido([L.lomo(['3/4', 'Huevo'], 2, { observacion: 'sin ají' }), L.gaseosa(1)], {
        nota: 'rápido',
      }),
    );
    const d = await detalle(t().mozo, creado.id);
    expect(d).toMatchObject({
      id: creado.id,
      tipo: 'PEDIDO',
      estado: 'PENDIENTE',
      mesa: { id: mesa.id, nombre: mesa.nombre },
      nota: 'rápido',
      unidades: 3,
      total: '70.00',
      totalCliente: '70.00',
      totalActual: '70.00',
      motivoDescarte: null,
      lineasPasadas: null,
    });
    expect(d.lineas.map((l) => l.posicion)).toEqual([0, 1]);
    expect(d.lineas[0]).toMatchObject({
      productoId: esc.carta.lomo,
      nombre: 'Lomo saltado',
      cantidad: 2,
      observacion: 'sin ají',
      precioCliente: '30.50',
      revision: { disponible: true, precioUnitario: '30.50', total: '61.00' },
    });
    expect(d.lineas[0]!.modificadores.map((m) => m.nombre).sort()).toEqual(['3/4', 'Huevo']);
    expect(d.lineas[0]!.modificadores.find((m) => m.nombre === 'Huevo')).toMatchObject({
      id: esc.carta.mod['Huevo'],
      precioExtra: '2.50',
    });
    expect(d.lineas[1]).toMatchObject({
      productoId: esc.carta.gaseosa,
      cantidad: 1,
      observacion: null,
      precioCliente: '9.00',
      revision: { disponible: true, precioUnitario: '9.00', total: '9.00' },
    });
  });

  it('un llamado sin pedido no tiene líneas ni totales', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    const d = await detalle(t().mozo, creado.id);
    expect(d).toMatchObject({
      tipo: 'PEDIR_CUENTA',
      lineas: [],
      totalCliente: null,
      totalActual: null,
      unidades: 0,
    });
  });

  it('un producto agotado después del pedido se marca no disponible, no cuenta en totalActual y se recupera al reactivarlo', async () => {
    const plato = await productoPropio(ctx, esc, '15.00');
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(
      ctx,
      mesa,
      cuerpoPedido([lineaDe(plato.id, 2), L.gaseosa(1)]),
    );
    await agotar(ctx, t().cocina, plato.id);
    try {
      const d = await detalle(t().mozo, creado.id);
      const agotada = d.lineas[0]!.revision;
      expect(agotada.disponible).toBe(false);
      if (!agotada.disponible) {
        expect(agotada.codigo.length).toBeGreaterThan(0);
        expect(agotada.motivo.length).toBeGreaterThan(0);
      }
      expect(d.lineas[1]!.revision).toMatchObject({ disponible: true });
      expect(d.totalCliente).toBe('39.00');
      expect(d.totalActual).toBe('9.00');
    } finally {
      await reactivar(ctx, t().cocina, plato.id);
    }
    expect((await detalle(t().mozo, creado.id)).totalActual).toBe('39.00');
  });

  it('un componente agotado (Hamburguesa) marca el combo con COMPONENTE_NO_DISPONIBLE', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(
      ctx,
      mesa,
      cuerpoPedido([L.combo(['Chicha', 'Ensalada'], 1), L.gaseosa(1)]),
    );
    await agotar(ctx, t().cocina, esc.carta.hamburguesa);
    try {
      const d = await detalle(t().mozo, creado.id);
      expect(d.lineas[0]!.revision).toMatchObject({
        disponible: false,
        codigo: 'COMPONENTE_NO_DISPONIBLE',
      });
      expect(d.totalActual).toBe('9.00');
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.hamburguesa);
    }
  });

  it('una opción agotada (Cerveza) marca la línea del combo no disponible', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(
      ctx,
      mesa,
      cuerpoPedido([L.combo(['Cerveza', 'Ensalada'], 1)]),
    );
    await agotar(ctx, t().cocina, esc.carta.cervezaPilsen);
    try {
      const d = await detalle(t().mozo, creado.id);
      expect(d.lineas[0]!.revision.disponible).toBe(false);
      expect(d.totalActual).toBe('0.00');
    } finally {
      await reactivar(ctx, t().cocina, esc.carta.cervezaPilsen);
    }
  });

  it('un precio que cambió: revision trae el precio del sistema, precioCliente el que vio el cliente', async () => {
    const plato = await productoPropio(ctx, esc, '20.00');
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([lineaDe(plato.id, 2)]));
    await cambiarProducto(ctx, esc, plato.id, { precio: '25.00' });
    const d = await detalle(t().mozo, creado.id);
    expect(d.lineas[0]).toMatchObject({
      precioCliente: '20.00',
      revision: { disponible: true, precioUnitario: '25.00', total: '50.00' },
    });
    expect(d.totalCliente).toBe('40.00');
    expect(d.totalActual).toBe('50.00');
  });

  it('un llamado de otra sucursal de A, de B o inexistente responde el mismo 404', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    const deS2 = await detalleDeLlamado(ctx, t().mozoS2, creado.id);
    const deB = await detalleDeLlamado(ctx, t().mozoB, creado.id);
    const inexistente = randomUUID();
    const sinFila = await detalleDeLlamado(ctx, t().mozo, inexistente);
    esperarError(deS2, 404, 'NO_ENCONTRADO');
    esperarError(deB, 404, 'NO_ENCONTRADO');
    esperarError(sinFila, 404, 'NO_ENCONTRADO');
    expect(sinIds(deS2, [creado.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect(sinIds(deB, [creado.id])).toEqual(sinIds(sinFila, [inexistente]));
  });
});

// ===================================================================================================
// Criterios 41 y 42 · atender
// ===================================================================================================

describe('criterios 41 y 42 · atender', () => {
  it('con la mesa libre abre la orden con el ordenId y los comensales, deja al que atiende como responsable y publica salon.cambio y orden.cambio', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const ordenId = randomUUID();
    await limpiarRegistros(ctx);

    const res = await atenderLlamado(ctx, t().mozo, creado.id, { ordenId, comensales: 3 });
    exigirEstado(res, 200, 'atender con la mesa libre');
    const cuerpo = atencionRespuestaSchema.parse(res.body);
    expect(cuerpo.ordenId).toBe(ordenId);
    expect(cuerpo.mesaAbierta).toBe(true);
    expect(cuerpo.llamado).toMatchObject({
      id: creado.id,
      estado: 'ATENDIDO',
      atendidoPor: { id: mozo().id, nombre: nombreDe(mozo()) },
      atendidoEn: iso(),
      ordenId,
    });

    const enElMapa = await mesaEnElMapa(ctx, t().mozo, mesa.id);
    expect(enElMapa.estado).toBe('OCUPADA');
    expect(enElMapa.orden).toMatchObject({ id: ordenId, mozo: { id: mozo().id }, comensales: 3 });
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([ordenId]);

    const orden = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    exigirEstado(orden, 200, 'GET /ordenes/:id');
    expect(orden.body).toMatchObject({ estado: 'ABIERTA', mozo: { id: mozo().id }, comensales: 3 });
    // Atender abre la mesa, pero no manda nada a cocina.
    expect(orden.body.items).toEqual([]);

    const nombres = (await eventosPublicados(ctx)).map((e) => e.nombre).sort();
    expect(nombres).toContain('salon.cambio');
    expect(nombres).toContain('orden.cambio');
    expect(nombres).toContain('llamado.cambio');
    expect(nombres.filter((n) => n.startsWith('cocina.'))).toEqual([]);
    const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
    expect(fila).toMatchObject({
      estado: 'ATENDIDO',
      orden_id: ordenId,
      atendido_por_usuario_id: mozo().id,
    });
  });

  it('quien atiende queda como responsable aunque no sea quien tenía el aviso: otro mozo atiende y la orden es suya', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const ordenId = randomUUID();
    await atenderOk(ctx, t().mozo2, creado.id, { ordenId, comensales: 2 });
    const orden = await llamar(ctx, t().mozo2, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    expect(orden.body.mozo.id).toBe(esc.mozo2.id);
  });

  it.each([
    ['sin cuerpo', () => ({})],
    ['solo ordenId', () => ({ ordenId: randomUUID() })],
    ['solo comensales', () => ({ comensales: 2 })],
  ])(
    'con la mesa libre y %s es 409 MESA_LIBRE y no cambia nada; con los dos datos, 200',
    async (_n, cuerpo) => {
      const mesa = await nuevaMesa();
      const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
      const antes = await conteoDePedidos(admin, mesa.empresaId);
      await limpiarRegistros(ctx);

      const res = await atenderLlamado(ctx, t().mozo, creado.id, cuerpo());
      esperarError(res, 409, 'MESA_LIBRE');
      expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
      expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
      expect((await detalle(t().mozo, creado.id)).atendidoPor).toBeNull();
      expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
      expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);

      const bien = await atenderLlamado(ctx, t().mozo, creado.id, abriendo());
      exigirEstado(bien, 200, 'atender con los comensales');
    },
  );

  it('con la mesa ocupada usa su orden abierta e ignora ordenId y comensales; no publica salon.cambio ni orden.cambio', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo2, { comensales: 2 });
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    await limpiarRegistros(ctx);

    const res = await atenderLlamado(ctx, t().mozo, creado.id, {
      ordenId: randomUUID(),
      comensales: 7,
    });
    exigirEstado(res, 200, 'atender con la mesa ocupada');
    const cuerpo = atencionRespuestaSchema.parse(res.body);
    expect(cuerpo).toMatchObject({ ordenId, mesaAbierta: false });
    expect(cuerpo.llamado.estado).toBe('ATENDIDO');

    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([ordenId]);
    const orden = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${ordenId}` });
    // El responsable y los comensales no cambian.
    expect(orden.body).toMatchObject({ mozo: { id: esc.mozo2.id }, comensales: 2 });
    expect(await eventosDePedidos(ctx)).toEqual([]);
    expect((await eventosDeLlamado(ctx)).map((e) => e.nombre)).toEqual(['llamado.cambio']);
  });

  it('un PEDIR_CUENTA no abre la mesa libre: ordenId null, mesaAbierta false y la mesa sigue libre', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    await limpiarRegistros(ctx);
    for (const cuerpo of [{}, abriendo()]) {
      const res = await atenderLlamado(ctx, t().mozo, creado.id, cuerpo);
      exigirEstado(res, 200, 'atender un PEDIR_CUENTA');
      expect(atencionRespuestaSchema.parse(res.body)).toMatchObject({
        ordenId: null,
        mesaAbierta: false,
      });
      expect(res.body.llamado.estado).toBe('ATENDIDO');
    }
    expect((await mesaEnElMapa(ctx, t().mozo, mesa.id)).estado).toBe('LIBRE');
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
    expect(await eventosDePedidos(ctx)).toEqual([]);
  });

  it('un PEDIR_CUENTA con la mesa ocupada devuelve su orden', async () => {
    const mesa = await nuevaMesa();
    const ordenId = await abrirMesa(ctx, esc, mesa, t().mozo);
    const creado = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    const res = await atenderOk(ctx, t().mozo, creado.id, {});
    expect(res.body).toMatchObject({ ordenId, mesaAbierta: false });
  });

  it('si otra persona abre la mesa mientras se atiende, la atención usa esa orden y nunca quedan dos abiertas', async () => {
    for (let ronda = 0; ronda < 3; ronda += 1) {
      const mesa = await nuevaMesa();
      const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
      const ordenDeLaAtencion = randomUUID();
      const ordenDelOtro = randomUUID();
      const [atencion, apertura] = await Promise.all([
        atenderLlamado(ctx, t().mozo, creado.id, { ordenId: ordenDeLaAtencion, comensales: 2 }),
        llamar(ctx, t().mozo2, {
          metodo: 'post',
          ruta: '/ordenes',
          cuerpo: { id: ordenDelOtro, mesaId: mesa.id, comensales: 4 },
          cabeceras: clave(),
        }),
      ]);
      expect(atencion.status, atencion.text).toBe(200);
      expect([201, 409]).toContain(apertura.status);
      const abiertas = await ordenesAbiertasDeLaMesa(admin, mesa.id);
      expect(abiertas).toHaveLength(1);
      expect(atencion.body.ordenId).toBe(abiertas[0]);
      expect([ordenDeLaAtencion, ordenDelOtro]).toContain(abiertas[0]);
      if (apertura.status === 409) expect(abiertas[0]).toBe(ordenDeLaAtencion);
      if (apertura.status === 201) expect(atencion.body.mesaAbierta).toBe(false);
      expect(await estadoGuardado(mesa, creado.id)).toBe('ATENDIDO');
    }
  });

  it('una sesión de soporte (sin usuario) con la mesa libre recibe 422 REFERENCIA_INVALIDA y no atiende', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const abrir = await llamar(ctx, esc.e.sa.token, {
      metodo: 'post',
      ruta: `/plataforma/empresas/${A().empresaId}/soporte`,
      cuerpo: { motivo: 'Probar el llamado', sucursalId: A().S1 },
    });
    exigirEstado(abrir, 201, 'abrir soporte');
    const res = await atenderLlamado(ctx, abrir.body.token as string, creado.id, abriendo());
    esperarError(res, 422, 'REFERENCIA_INVALIDA');
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
  });

  it('una mesa inactiva responde 409 CONFLICTO sin atender', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await ponerActiva(ctx, esc, mesa, false);
    try {
      const res = await atenderLlamado(ctx, t().mozo, creado.id, abriendo());
      esperarError(res, 409, 'CONFLICTO');
      expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
      expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
    } finally {
      await ponerActiva(ctx, esc, mesa, true);
    }
  });

  it('una vez atendido no vence y la mesa puede mandar otro llamado', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    ctx.reloj.avanzar(20 * MINUTO);
    expect((await detalle(t().mozo, creado.id)).estado).toBe('ATENDIDO');
    const otro = await crearLlamado(ctx, mesa, cuerpoPedirCuenta());
    expect(otro.respuesta.estado).toBe('PENDIENTE');
  });
});

// ===================================================================================================
// Criterio 43 · dos a la vez, la misma persona otra vez, la réplica
// ===================================================================================================

describe('criterio 43 · dos atenciones a la vez', () => {
  it('exactamente una responde 200; la otra, 409 LLAMADO_TOMADO con quién lo atiende, y se abre una sola orden', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    await limpiarRegistros(ctx);
    const [a, b] = await Promise.all([
      atenderLlamado(ctx, t().mozo, creado.id, abriendo(2)),
      atenderLlamado(ctx, t().mozo2, creado.id, abriendo(5)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [ganador, perdedor] = a.status === 200 ? [a, b] : [b, a];
    const persona = a.status === 200 ? mozo() : esc.mozo2;
    esperarError(perdedor, 409, 'LLAMADO_TOMADO');
    expect(perdedor.body.atendidoPor).toEqual({ id: persona.id, nombre: nombreDe(persona) });
    expect(ganador.body.llamado.atendidoPor).toEqual({ id: persona.id, nombre: nombreDe(persona) });

    const abiertas = await ordenesAbiertasDeLaMesa(admin, mesa.id);
    expect(abiertas).toHaveLength(1);
    expect(ganador.body.ordenId).toBe(abiertas[0]);
    const orden = await llamar(ctx, t().mozo, { metodo: 'get', ruta: `/ordenes/${abiertas[0]!}` });
    expect(orden.body.mozo.id).toBe(persona.id);
    // Un solo aviso de cambio de estado.
    expect(await eventosDeLlamado(ctx, 'llamado.cambio')).toHaveLength(1);
  });

  it('también con la mesa ocupada: una gana y la otra recibe LLAMADO_TOMADO', async () => {
    const mesa = await nuevaMesa();
    await abrirMesa(ctx, esc, mesa, t().mozo);
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const [a, b] = await Promise.all([
      atenderLlamado(ctx, t().mozo, creado.id, {}),
      atenderLlamado(ctx, t().mozo2, creado.id, {}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    esperarError(a.status === 409 ? a : b, 409, 'LLAMADO_TOMADO');
  });

  it('quien llega después, ya atendido por otra persona, recibe LLAMADO_TOMADO con el nombre', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    const tarde = await atenderLlamado(ctx, t().mozo2, creado.id, abriendo());
    esperarError(tarde, 409, 'LLAMADO_TOMADO');
    expect(tarde.body.atendidoPor).toEqual({ id: mozo().id, nombre: nombreDe(mozo()) });
  });

  it('la misma persona otra vez (con otra clave) recibe 200 con el estado actual y sin efectos', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    const primera = await atenderOk(ctx, t().mozo, creado.id, abriendo());
    const antes = await conteoDePedidos(admin, mesa.empresaId);
    ctx.reloj.avanzar(MINUTO);
    await limpiarRegistros(ctx);

    const otra = await atenderLlamado(ctx, t().mozo, creado.id, abriendo());
    exigirEstado(otra, 200, 'atender otra vez');
    expect(otra.body.llamado).toMatchObject({
      estado: 'ATENDIDO',
      atendidoPor: { id: mozo().id },
      atendidoEn: primera.body.llamado.atendidoEn,
    });
    expect(otra.body.ordenId).toBe(primera.body.ordenId);
    expect(await conteoDePedidos(admin, mesa.empresaId)).toEqual(antes);
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([primera.body.ordenId]);
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('la misma clave devuelve la respuesta guardada, aunque el llamado ya haya cambiado', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    const k = randomUUID();
    // La réplica reenvía exactamente el mismo cuerpo (mismo ordenId): otro cuerpo con la misma clave sería 422.
    const cuerpo = abriendo();
    const primera = await atenderLlamado(ctx, t().mozo, creado.id, cuerpo, k);
    exigirEstado(primera, 200, 'atender');
    // Otra persona descarta el pedido atendido; la réplica de la misma clave sigue devolviendo lo guardado.
    await descartarOk(ctx, t().mozo2, creado.id, { motivo: 'Repetido' });
    await limpiarRegistros(ctx);
    const replica = await atenderLlamado(ctx, t().mozo, creado.id, cuerpo, k);
    exigirEstado(replica, 200, 'réplica de la atención');
    expect(replica.body).toEqual(primera.body);
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });
});

// ===================================================================================================
// Criterio 44 · lo que no se atiende
// ===================================================================================================

describe('criterio 44 · lo que no se atiende', () => {
  it('un llamado vencido es 409 LLAMADO_VENCIDO y queda guardado como VENCIDO, sin abrir la mesa', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido([L.gaseosa(1)]));
    ctx.reloj.avanzar(15 * MINUTO);
    await limpiarRegistros(ctx);
    const res = await atenderLlamado(ctx, t().mozo, creado.id, abriendo());
    esperarError(res, 409, 'LLAMADO_VENCIDO');
    const fila = (await filaLlamado(admin, mesa.empresaId, creado.id))!;
    expect(fila.estado).toBe('VENCIDO');
    expect(fila.vencido_en).not.toBeNull();
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
    // Y sigue siendo 409 LLAMADO_VENCIDO después de guardado.
    esperarError(
      await atenderLlamado(ctx, t().mozo, creado.id, abriendo()),
      409,
      'LLAMADO_VENCIDO',
    );
  });

  it('a los 14:59.999 todavía se atiende; a los 15:00 ya no', async () => {
    const [a, b] = await mesasConCodigo(ctx, esc, 2);
    const aTiempo = await crearLlamado(ctx, a!, cuerpoLlamarMozo());
    const tarde = await crearLlamado(ctx, b!, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO - 1);
    await atenderOk(ctx, t().mozo, aTiempo.id, abriendo());
    ctx.reloj.avanzar(1);
    esperarError(await atenderLlamado(ctx, t().mozo, tarde.id, abriendo()), 409, 'LLAMADO_VENCIDO');
  });

  it('un llamado PASADO_A_CUENTA o DESCARTADO es 409 LLAMADO_CERRADO con su estado', async () => {
    const [mp, md] = await mesasConCodigo(ctx, esc, 2);
    const pasado = await crearLlamado(ctx, mp!, cuerpoPedido([L.gaseosa(1)]));
    await atenderOk(ctx, t().mozo, pasado.id, abriendo());
    await pasarOk(ctx, t().mozo, pasado.id, [{ posicion: 0, cantidad: 1 }]);
    const descartado = await crearLlamado(ctx, md!, cuerpoLlamarMozo());
    await descartarOk(ctx, t().mozo, descartado.id);

    const resP = await atenderLlamado(ctx, t().mozo2, pasado.id, abriendo());
    esperarError(resP, 409, 'LLAMADO_CERRADO');
    expect(resP.body.estado).toBe('PASADO_A_CUENTA');
    const resD = await atenderLlamado(ctx, t().mozo2, descartado.id, abriendo());
    esperarError(resD, 409, 'LLAMADO_CERRADO');
    expect(resD.body.estado).toBe('DESCARTADO');
  });

  it('un llamado de otra sucursal de A o de B es 404, igual que uno inexistente, y no cambia', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const inexistente = randomUUID();
    const deS2 = await atenderLlamado(ctx, t().mozoS2, creado.id, abriendo());
    const deB = await atenderLlamado(ctx, t().mozoB, creado.id, abriendo());
    const sinFila = await atenderLlamado(ctx, t().mozo, inexistente, abriendo());
    esperarError(deS2, 404, 'NO_ENCONTRADO');
    esperarError(deB, 404, 'NO_ENCONTRADO');
    esperarError(sinFila, 404, 'NO_ENCONTRADO');
    expect(sinIds(deS2, [creado.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect(sinIds(deB, [creado.id])).toEqual(sinIds(sinFila, [inexistente]));
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
    expect(await ordenesAbiertasDeLaMesa(admin, mesa.id)).toEqual([]);
  });
});

// ===================================================================================================
// Forma y orden de los rechazos de la atención
// ===================================================================================================

describe('forma de la atención y orden de los rechazos', () => {
  it('sin Idempotency-Key es 400 con campos y no atiende', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/llamados/${creado.id}/atencion`,
      cuerpo: abriendo(),
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(JSON.stringify(res.body.campos)).toContain('Idempotency-Key');
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
  });

  it.each([
    ['comensales 0', { comensales: 0, ordenId: randomUUID() }],
    ['comensales 100', { comensales: 100, ordenId: randomUUID() }],
    ['comensales con decimales', { comensales: 2.5, ordenId: randomUUID() }],
    ['ordenId que no es un UUID', { comensales: 2, ordenId: 'orden-1' }],
    ['un campo desconocido', { comensales: 2, ordenId: randomUUID(), mozoId: randomUUID() }],
    ['mesaId en el cuerpo', { mesaId: randomUUID() }],
  ])('%s es 400 DATOS_INVALIDOS y el llamado sigue pendiente', async (_n, cuerpo) => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    esperarError(await atenderLlamado(ctx, t().mozo, creado.id, cuerpo), 400, 'DATOS_INVALIDOS');
    expect(await estadoGuardado(mesa, creado.id)).toBe('PENDIENTE');
  });

  it('la forma (400) va antes que el 404: sin clave sobre un llamado inexistente es 400', async () => {
    const inexistente = randomUUID();
    const sinClave = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/llamados/${inexistente}/atencion`,
      cuerpo: {},
    });
    esperarError(sinClave, 400, 'DATOS_INVALIDOS');
    // Con la clave, el mismo pedido llega al 404 (la forma pasó).
    esperarError(await atenderLlamado(ctx, t().mozo, inexistente, {}), 404, 'NO_ENCONTRADO');
  });
});

// ===================================================================================================
// Criterio 45 · llamado.cambio al atender
// ===================================================================================================

describe('criterio 45 · llamado.cambio', () => {
  it('atender publica llamado.cambio { llamadoId, mesaId, estado } en la sala de la sucursal, solo después de confirmar', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await limpiarRegistros(ctx);
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    const eventos = await eventosDeLlamado(ctx, 'llamado.cambio');
    expect(eventos).toHaveLength(1);
    const evento = eventoLlamadoCambioSchema.parse(eventos[0]);
    expect(evento.empresaId).toBe(A().empresaId);
    expect(evento.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
    expect(evento.datos).toEqual({ llamadoId: creado.id, mesaId: mesa.id, estado: 'ATENDIDO' });
    expect(JSON.stringify(eventos[0]).length).toBeLessThan(4096);
  });

  it('una réplica y un rechazo no publican nada', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const k = randomUUID();
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    await atenderLlamado(ctx, t().mozo, creado.id, abriendo(), k);
    await limpiarRegistros(ctx);
    // Réplica de la misma clave, otra vez la misma persona, otra persona (409), 404 y forma inválida.
    await atenderLlamado(ctx, t().mozo, creado.id, abriendo(), k);
    await atenderLlamado(ctx, t().mozo, creado.id, abriendo());
    esperarError(
      await atenderLlamado(ctx, t().mozo2, creado.id, abriendo()),
      409,
      'LLAMADO_TOMADO',
    );
    esperarError(
      await atenderLlamado(ctx, t().mozoS2, creado.id, abriendo()),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await atenderLlamado(ctx, t().mozo, creado.id, { comensales: 0 }),
      400,
      'DATOS_INVALIDOS',
    );
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });

  it('el vencimiento no publica nada: guardar un llamado como VENCIDO al tocarlo no emite eventos', async () => {
    const mesa = await nuevaMesa();
    const vencido = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO);
    await limpiarRegistros(ctx);
    esperarError(
      await atenderLlamado(ctx, t().mozo, vencido.id, abriendo()),
      409,
      'LLAMADO_VENCIDO',
    );
    expect(await estadoGuardado(mesa, vencido.id)).toBe('VENCIDO');
    expect((await eventosPublicados(ctx)).map((e) => e.nombre)).toEqual([]);
  });
});
