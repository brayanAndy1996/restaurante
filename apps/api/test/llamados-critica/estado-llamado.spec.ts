// spec: 005-carta-web-mesa (pruebas protegidas)
//
// P2 · Lo que ve el cliente de su mesa y de su llamado · Criterios 25 y 38 (con 14 y 21 en lo que sale al
// cliente). La API real con `RelojManual` y `PublicadorEnMemoria`, dos empresas (A con S1 y S2, y B), la carta
// de ejemplo de 004, la carta web publicada por sus rutas y un `ClientePublico` por cliente.
//
// Cubre: `GET /publico/mesas/:codigo` con su forma estricta, sus tres cabeceras, el aviso fuera de horario y con
// cuenta abierta, el llamado pendiente vigente y que no revela si la mesa está ocupada ni quién la atiende (25);
// y `GET /publico/mesas/:codigo/llamados/:id` con cada estado vigente (también el vencido calculado, sin que
// nadie lo toque), sin nombres de personas, con `no-store`, y el mismo 404 para un llamado de otra mesa de la
// misma sucursal, de B o inexistente (38).
import { estadoLlamadoPublicoSchema, mesaPublicaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enviarOk } from '../salon-critica/fabrica-p2';
import {
  DESPUES_DE_CERRAR,
  HORA_DE_SERVICIO,
  MINUTO,
  abriendo,
  abrirMesa,
  arrancarLlamados,
  atenderOk,
  clavesEn,
  clienteNuevo,
  crearLlamado,
  cuerpoLlamarMozo,
  cuerpoPedido,
  cuerpoPedirCuenta,
  descartarOk,
  esperarNoDisponible,
  exigirEstado,
  lineasDelPedido,
  mesaConCodigo,
  mesasConCodigo,
  nombreDe,
  pasarOk,
  prepararEscenarioLlamados,
  verEstado,
  verMesa,
  type AppLlamados,
  type EscenarioLlamados,
  type Lugar,
  type MesaLlamados,
} from './fabrica-llamados';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppLlamados;
let admin: Client;
let esc: EscenarioLlamados;

const t = () => esc.token;
const nuevaMesa = (lugar: Lugar = 'S1'): Promise<MesaLlamados> => mesaConCodigo(ctx, esc, lugar);

beforeAll(async () => {
  ctx = await arrancarLlamados();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioLlamados(ctx);
});

beforeEach(() => {
  ctx.reloj.fijar(HORA_DE_SERVICIO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ===================================================================================================
// Criterio 25 · la mesa
// ===================================================================================================

describe('criterio 25 · GET /publico/mesas/:codigo', () => {
  it('responde 200 con el nombre de la mesa, las direcciones de la carta y la forma estricta', async () => {
    const mesa = await nuevaMesa();
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'GET /publico/mesas/:codigo');
    expect(mesaPublicaSchema.parse(res.body)).toEqual({
      mesa: { nombre: mesa.nombre },
      carta: { empresaSlug: esc.slugs.empresaA, sucursalSlug: esc.slugs.sucursalS1 },
      aceptaLlamados: true,
      motivoNoAcepta: null,
      llamadoPendiente: null,
    });
    // Las claves son exactamente las del contrato, a cualquier profundidad.
    expect([...clavesEn(res.body)].sort()).toEqual(
      [
        'aceptaLlamados',
        'carta',
        'empresaSlug',
        'llamadoPendiente',
        'mesa',
        'motivoNoAcepta',
        'nombre',
        'sucursalSlug',
      ].sort(),
    );
  });

  it('lleva Cache-Control: no-store, X-Robots-Tag: noindex y Referrer-Policy: no-referrer', async () => {
    const mesa = await nuevaMesa();
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'GET /publico/mesas/:codigo');
    expect(res.headers['cache-control']).toMatch(/\bno-store\b/);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('la mesa de S2 dice la dirección de S2 (la sucursal sale de la mesa, no del cliente)', async () => {
    const mesa = await nuevaMesa('S2');
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'GET /publico/mesas/:codigo de S2');
    expect(res.body.carta).toEqual({
      empresaSlug: esc.slugs.empresaA,
      sucursalSlug: esc.slugs.sucursalS2,
    });
    expect(res.body.mesa).toEqual({ nombre: mesa.nombre });
  });

  it('no dice si la mesa está ocupada ni el mozo, la cuenta o lo consumido: libre y ocupada responden con las mismas claves', async () => {
    const [libre, ocupada] = await mesasConCodigo(ctx, esc, 2);
    const ordenId = await abrirMesa(ctx, esc, ocupada!, t().mozo, { comensales: 3 });
    await enviarOk(ctx, t().mozo, ordenId, [...lineasDelPedido(esc)]);

    const cliente = clienteNuevo(ctx);
    const deLibre = await verMesa(cliente, libre!.codigo);
    const deOcupada = await verMesa(cliente, ocupada!.codigo);
    exigirEstado(deLibre, 200, 'mesa libre');
    exigirEstado(deOcupada, 200, 'mesa ocupada');
    expect([...clavesEn(deOcupada.body)].sort()).toEqual([...clavesEn(deLibre.body)].sort());
    expect({ ...deOcupada.body, mesa: null }).toEqual({ ...deLibre.body, mesa: null });
    for (const dato of [nombreDe(esc.e.A.mozo), esc.e.A.mozo.id, ordenId, '70.00', 'Lomo']) {
      expect(deOcupada.text).not.toContain(dato);
    }
  });

  it.each([
    ['PEDIDO', () => cuerpoPedido(lineasDelPedido(esc))],
    ['LLAMAR_MOZO', () => cuerpoLlamarMozo()],
    ['PEDIR_CUENTA', () => cuerpoPedirCuenta()],
  ] as const)(
    'con un %s pendiente vigente, llamadoPendiente trae su tipo y su vencimiento',
    async (tipo, hacer) => {
      const mesa = await nuevaMesa();
      const creado = await crearLlamado(ctx, mesa, hacer());
      const res = await verMesa(creado.cliente, mesa.codigo);
      exigirEstado(res, 200, 'GET /publico/mesas/:codigo');
      expect(res.body.llamadoPendiente).toEqual({ tipo, venceEn: creado.respuesta.venceEn });
      // Sigue aceptando: el cliente ve "Ya avisamos al mozo" por el pendiente, no por el horario.
      expect(res.body.aceptaLlamados).toBe(true);
    },
  );

  it('llamadoPendiente es null cuando el llamado se atiende, se descarta o vence (a los 15:00 en punto)', async () => {
    const [atendida, descartada, vencida] = await mesasConCodigo(ctx, esc, 3);
    const cliente = clienteNuevo(ctx);

    const a = await crearLlamado(ctx, atendida!, cuerpoLlamarMozo());
    await atenderOk(ctx, t().mozo, a.id, abriendo());
    expect((await verMesa(cliente, atendida!.codigo)).body.llamadoPendiente).toBeNull();

    const d = await crearLlamado(ctx, descartada!, cuerpoPedirCuenta());
    await descartarOk(ctx, t().mozo, d.id, { motivo: 'Pedido falso' });
    expect((await verMesa(cliente, descartada!.codigo)).body.llamadoPendiente).toBeNull();

    const v = await crearLlamado(ctx, vencida!, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO - 1);
    expect((await verMesa(cliente, vencida!.codigo)).body.llamadoPendiente).toEqual({
      tipo: 'LLAMAR_MOZO',
      venceEn: v.respuesta.venceEn,
    });
    ctx.reloj.avanzar(1);
    expect((await verMesa(cliente, vencida!.codigo)).body.llamadoPendiente).toBeNull();
  });

  it('fuera de horario sin cuenta abierta: aceptaLlamados false y motivoNoAcepta FUERA_DE_HORARIO; la carta se sigue viendo', async () => {
    const mesa = await nuevaMesa();
    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'la mesa fuera de horario');
    expect(res.body).toMatchObject({
      mesa: { nombre: mesa.nombre },
      aceptaLlamados: false,
      motivoNoAcepta: 'FUERA_DE_HORARIO',
      llamadoPendiente: null,
    });
    mesaPublicaSchema.parse(res.body);
  });

  it('fuera de horario con una cuenta abierta acepta (los clientes que siguen después del cierre)', async () => {
    const mesa = await nuevaMesa();
    await abrirMesa(ctx, esc, mesa, t().mozo);
    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'la mesa con cuenta');
    expect(res.body).toMatchObject({ aceptaLlamados: true, motivoNoAcepta: null });
  });

  it('una sucursal sin horario cargado acepta a toda hora (S2)', async () => {
    const mesa = await nuevaMesa('S2');
    ctx.reloj.fijar(DESPUES_DE_CERRAR);
    const res = await verMesa(clienteNuevo(ctx), mesa.codigo);
    exigirEstado(res, 200, 'la mesa de S2 fuera de las horas de S1');
    expect(res.body).toMatchObject({ aceptaLlamados: true, motivoNoAcepta: null });
  });

  it('un código con la forma correcta que no existe responde el 404 de siempre', async () => {
    esperarNoDisponible(
      await verMesa(clienteNuevo(ctx), randomUUID().replace(/-/g, '').slice(0, 22)),
    );
  });
});

// ===================================================================================================
// Criterio 38 · el estado del llamado
// ===================================================================================================

describe('criterio 38 · GET /publico/mesas/:codigo/llamados/:id', () => {
  it('un llamado pendiente responde 200 { id, tipo, estado, venceEn } con la forma estricta y Cache-Control: no-store', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const res = await verEstado(creado.cliente, mesa.codigo, creado.id);
    exigirEstado(res, 200, 'estado del llamado');
    expect(estadoLlamadoPublicoSchema.parse(res.body)).toEqual({
      id: creado.id,
      tipo: 'PEDIDO',
      estado: 'PENDIENTE',
      venceEn: creado.respuesta.venceEn,
    });
    expect(res.headers['cache-control']).toMatch(/\bno-store\b/);
  });

  it('lo puede leer otro cliente (otra IP) que tenga el código de la mesa y el id', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    const res = await verEstado(clienteNuevo(ctx), mesa.codigo, creado.id);
    exigirEstado(res, 200, 'estado desde otra IP');
    expect(res.body).toMatchObject({ id: creado.id, estado: 'PENDIENTE' });
  });

  it('ATENDIDO: lo dice sin nombres de personas ni ids de usuarios u órdenes', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoPedido(lineasDelPedido(esc)));
    const atencion = abriendo(2);
    await atenderOk(ctx, t().mozo, creado.id, atencion);
    const res = await verEstado(creado.cliente, mesa.codigo, creado.id);
    exigirEstado(res, 200, 'estado atendido');
    expect(res.body).toEqual({
      id: creado.id,
      tipo: 'PEDIDO',
      estado: 'ATENDIDO',
      venceEn: creado.respuesta.venceEn,
    });
    for (const secreto of [nombreDe(esc.e.A.mozo), esc.e.A.mozo.id, atencion.ordenId]) {
      expect(res.text).not.toContain(secreto);
    }
  });

  it('PASADO_A_CUENTA y DESCARTADO se ven como tales', async () => {
    const [aCuenta, descartada] = await mesasConCodigo(ctx, esc, 2);
    const p = await crearLlamado(ctx, aCuenta!, cuerpoPedido(lineasDelPedido(esc)));
    await atenderOk(ctx, t().mozo, p.id, abriendo());
    await pasarOk(ctx, t().mozo, p.id, [
      { posicion: 0, cantidad: 2 },
      { posicion: 1, cantidad: 1 },
    ]);
    const resP = await verEstado(p.cliente, aCuenta!.codigo, p.id);
    exigirEstado(resP, 200, 'estado pasado a cuenta');
    expect(resP.body.estado).toBe('PASADO_A_CUENTA');
    expect(Object.keys(resP.body as object).sort()).toEqual(['estado', 'id', 'tipo', 'venceEn']);

    const d = await crearLlamado(ctx, descartada!, cuerpoPedirCuenta());
    await descartarOk(ctx, t().mozo, d.id, { motivo: 'Ya lo pidió al mozo' });
    const resD = await verEstado(d.cliente, descartada!.codigo, d.id);
    exigirEstado(resD, 200, 'estado descartado');
    expect(resD.body.estado).toBe('DESCARTADO');
    // El motivo del descarte es del mozo, no del cliente.
    expect(resD.text).not.toContain('Ya lo pidió al mozo');
  });

  it('VENCIDO se calcula con el reloj de la API aunque nadie toque el llamado: 14:59.999 PENDIENTE, 15:00 VENCIDO', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    ctx.reloj.avanzar(15 * MINUTO - 1);
    expect((await verEstado(creado.cliente, mesa.codigo, creado.id)).body.estado).toBe('PENDIENTE');
    ctx.reloj.avanzar(1);
    const res = await verEstado(creado.cliente, mesa.codigo, creado.id);
    exigirEstado(res, 200, 'estado vencido');
    expect(res.body).toEqual({
      id: creado.id,
      tipo: 'LLAMAR_MOZO',
      estado: 'VENCIDO',
      venceEn: creado.respuesta.venceEn,
    });
  });

  it('un ATENDIDO no vence: sigue ATENDIDO una hora después', async () => {
    const mesa = await nuevaMesa();
    const creado = await crearLlamado(ctx, mesa, cuerpoLlamarMozo());
    await atenderOk(ctx, t().mozo, creado.id, abriendo());
    ctx.reloj.avanzar(60 * MINUTO);
    expect((await verEstado(creado.cliente, mesa.codigo, creado.id)).body.estado).toBe('ATENDIDO');
  });

  it('un llamado de otra mesa de la misma sucursal responde el mismo 404, aunque el id exista', async () => {
    const [unaMesa, otraMesa] = await mesasConCodigo(ctx, esc, 2);
    const creado = await crearLlamado(ctx, unaMesa!, cuerpoLlamarMozo());
    const cliente = clienteNuevo(ctx);
    exigirEstado(await verEstado(cliente, unaMesa!.codigo, creado.id), 200, 'con su propia mesa');
    esperarNoDisponible(await verEstado(cliente, otraMesa!.codigo, creado.id));
  });

  it('un llamado de B usado con el código de una mesa de A responde el mismo 404', async () => {
    const mesaA = await nuevaMesa();
    const mesaB = await nuevaMesa('B1');
    const deB = await crearLlamado(ctx, mesaB, cuerpoLlamarMozo());
    const cliente = clienteNuevo(ctx);
    esperarNoDisponible(await verEstado(cliente, mesaA.codigo, deB.id));
    // Con su propio código sí se ve.
    exigirEstado(await verEstado(cliente, mesaB.codigo, deB.id), 200, 'con el código de B');
  });

  it('un llamado de una mesa de S2 usado con el código de una mesa de S1 responde el mismo 404', async () => {
    const mesaS1 = await nuevaMesa();
    const mesaS2 = await nuevaMesa('S2');
    const deS2 = await crearLlamado(ctx, mesaS2, cuerpoLlamarMozo());
    esperarNoDisponible(await verEstado(clienteNuevo(ctx), mesaS1.codigo, deS2.id));
  });

  it('un id inexistente y un código desconocido responden el mismo 404 que los casos anteriores', async () => {
    const mesa = await nuevaMesa();
    const cliente = clienteNuevo(ctx);
    const inexistente = await verEstado(cliente, mesa.codigo, randomUUID());
    esperarNoDisponible(inexistente);
    const sinCodigo = await verEstado(cliente, 'Z'.repeat(22), randomUUID());
    esperarNoDisponible(sinCodigo);
    expect(sinCodigo.body).toEqual(inexistente.body);
  });

  it('el estado de un llamado de otra empresa nunca se revela, ni su existencia ni su estado', async () => {
    const mesaA = await nuevaMesa();
    const mesaB = await nuevaMesa('B1');
    const deB = await crearLlamado(ctx, mesaB, cuerpoLlamarMozo());
    const conIdDeB = await verEstado(clienteNuevo(ctx), mesaA.codigo, deB.id);
    const conIdInexistente = await verEstado(clienteNuevo(ctx), mesaA.codigo, randomUUID());
    esperarNoDisponible(conIdDeB);
    expect(JSON.stringify(conIdDeB.body)).toBe(JSON.stringify(conIdInexistente.body));
  });
});
