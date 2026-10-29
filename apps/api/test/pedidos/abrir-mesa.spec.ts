// Historia 004 · salón y cocina, grupo C2 · abrir una mesa y cambiar los comensales (criterios 9 a 14, 55 y 85):
// pruebas del desarrollador (no protegidas). La atribución del mozo responsable (criterio 10), el aislamiento y
// los permisos de todas las rutas los cubren las pruebas protegidas de `salon-critica/`.
import { randomUUID } from 'node:crypto';
import { ordenRespuestaSchema } from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  abrirOrden,
  arrancarP3,
  asentar,
  crearEscenarioP3,
  esperarError,
  exigirEstado,
  filasDe,
  leerOrden,
  leerSalon,
  llamar,
  mesaEnSalon,
  sesiones,
  type AppP3,
  type EscenarioP3,
} from '../salon-critica/fabrica-p3';
import { anularPorSql, ponerEstado } from './ayudas-pedidos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP3;
let e: EscenarioP3;
let admin: Client;
let api: Client;
let mesasS1: PoolDeMesas;
let mesasS2: PoolDeMesas;
let mesasB: PoolDeMesas;
let mozo: string;
let cajero: string;
let cocina: string;
let mozoDeS2: string;
let mozoB: string;

beforeAll(async () => {
  ctx = await arrancarP3();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
  e = await crearEscenarioP3(ctx);
  mesasS1 = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1);
  mesasS2 = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S2);
  mesasB = new PoolDeMesas(ctx, e.B.tokenAdmin, e.B.S1);
  mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
  cajero = (await sesiones(ctx, e.A.cajero, e.A.S1)).contrasena;
  cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
  // El Cajero es Mozo en S2.
  mozoDeS2 = (await sesiones(ctx, e.A.cajero, e.A.S2)).contrasena;
  mozoB = (await sesiones(ctx, e.B.mozo, e.B.S1)).contrasena;
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

const ordenesDe = (mesaId: string) =>
  filasDe(admin, 'orden_mesa', 'mesa_id = $1', [mesaId]) as Promise<{ orden_id: string }[]>;

describe('criterio 9 · abrir una mesa', () => {
  it('responde 201 con una orden MESA / SALON / ABIERTA de la sucursal activa, a nombre de quien abre y con la mesa ocupada', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    const antes = ctx.reloj.ahora();
    const res = await abrirOrden(ctx, mozo, { id, mesaId: mesa.id, comensales: 4 });
    exigirEstado(res, 201, 'abrir la mesa');
    const orden = ordenRespuestaSchema.parse(res.body);
    expect(orden).toMatchObject({
      id,
      sucursalId: e.A.S1,
      tipo: 'MESA',
      canal: 'SALON',
      estado: 'ABIERTA',
      comensales: 4,
      anuladaEn: null,
      sinConsumo: false,
      unidaA: null,
      items: [],
      total: '0.00',
      precuentaVigente: null,
    });
    expect(orden.mesas).toEqual([{ id: mesa.id, nombre: mesa.nombre }]);
    expect(orden.mozo.id).toBe(e.A.mozo.id);
    // La hora sale del reloj de la API.
    expect(orden.abiertaEn).toBe(antes.toISOString());
    const guardada = (await filasDe(admin, 'orden', 'id = $1', [id]))[0]!;
    expect(guardada).toMatchObject({ version: 1, sin_consumo: false, cerrada_en: null });
    const mapa = await mesaEnSalon(ctx, mozo, mesa.id);
    expect(mapa.estado).toBe('OCUPADA');
    expect(mapa.orden).toMatchObject({ id, comensales: 4, total: '0.00' });
  });

  it('una mesa libre más: el id en mayúsculas es el mismo recurso que en minúsculas', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    const res = await abrirOrden(ctx, mozo, {
      id: id.toUpperCase(),
      mesaId: mesa.id.toUpperCase(),
    });
    exigirEstado(res, 201, 'abrir con ids en mayúsculas');
    expect(res.body.id).toBe(id);
    expect(res.body.mesas).toEqual([{ id: mesa.id, nombre: mesa.nombre }]);
  });

  it('exige la Idempotency-Key (400 con campos en Idempotency-Key) y que sea un UUID; no deja nada', async () => {
    const mesa = await mesasS1.siguiente();
    const sinClave = await abrirOrden(ctx, mozo, { mesaId: mesa.id }, { clave: null });
    esperarError(sinClave, 400, 'DATOS_INVALIDOS');
    expect(sinClave.body.campos).toEqual([
      { campo: 'Idempotency-Key', mensaje: expect.any(String) },
    ]);
    const mala = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: '/ordenes',
      cuerpo: { id: randomUUID(), mesaId: mesa.id, comensales: 2 },
      cabeceras: { 'Idempotency-Key': 'no-es-un-uuid' },
    });
    esperarError(mala, 400, 'DATOS_INVALIDOS');
    expect(await ordenesDe(mesa.id)).toEqual([]);
  });

  it('valida la forma: campo desconocido, empresaId, sucursalId, comensales fuera de 1 a 99 o decimal, ids que no son UUID', async () => {
    const mesa = await mesasS1.siguiente();
    const base = { id: randomUUID(), mesaId: mesa.id, comensales: 2 };
    const malos: unknown[] = [
      { ...base, extra: 1 },
      { ...base, empresaId: e.A.empresaId },
      { ...base, sucursalId: e.A.S2 },
      { ...base, creadoPorUsuarioId: e.A.mozo.id },
      { ...base, comensales: 0 },
      { ...base, comensales: 100 },
      { ...base, comensales: 1.5 },
      { ...base, comensales: '2' },
      { ...base, id: 'x' },
      { ...base, mesaId: 'x' },
      { mesaId: mesa.id, comensales: 2 },
      { id: base.id, comensales: 2 },
      { id: base.id, mesaId: mesa.id },
    ];
    for (const cuerpo of malos) {
      const res = await llamar(ctx, mozo, {
        metodo: 'post',
        ruta: '/ordenes',
        cuerpo,
        cabeceras: { 'Idempotency-Key': randomUUID() },
      });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect(await ordenesDe(mesa.id)).toEqual([]);
    // Los límites se aceptan.
    exigirEstado(await abrirOrden(ctx, mozo, { mesaId: mesa.id, comensales: 99 }), 201, 'con 99');
    const otra = await mesasS1.siguiente();
    exigirEstado(await abrirOrden(ctx, mozo, { mesaId: otra.id, comensales: 1 }), 201, 'con 1');
  });

  it('una mesa de otra sucursal, de B o inexistente responde 404 con el mismo cuerpo y no deja nada', async () => {
    const deS2 = await mesasS2.siguiente();
    const deB = await mesasB.siguiente();
    const respuestas = [
      await abrirOrden(ctx, mozo, { mesaId: deS2.id }),
      await abrirOrden(ctx, mozo, { mesaId: deB.id }),
      await abrirOrden(ctx, mozo, { mesaId: randomUUID() }),
    ];
    for (const res of respuestas) esperarError(res, 404, 'NO_ENCONTRADO');
    expect(respuestas[1]!.body).toEqual(respuestas[2]!.body);
    expect(respuestas[0]!.body).toEqual(respuestas[2]!.body);
    expect(await ordenesDe(deS2.id)).toEqual([]);
    expect(await ordenesDe(deB.id)).toEqual([]);
  });

  it('una mesa inactiva responde 409 CONFLICTO', async () => {
    const mesa = await mesasS1.siguiente();
    exigirEstado(
      await llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/mesas/${mesa.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la mesa',
    );
    const res = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    esperarError(res, 409, 'CONFLICTO');
    expect(await ordenesDe(mesa.id)).toEqual([]);
  });

  it('el rol de Cocina/Barra no abre mesas (403) y nada cambia', async () => {
    const mesa = await mesasS1.siguiente();
    esperarError(await abrirOrden(ctx, cocina, { mesaId: mesa.id }), 403, 'PROHIBIDO');
    expect(await ordenesDe(mesa.id)).toEqual([]);
  });
});

describe('criterio 11 · mesa ocupada', () => {
  it('abrir una mesa con una orden abierta responde 409 MESA_OCUPADA con el ordenId de esa orden', async () => {
    const mesa = await mesasS1.siguiente();
    const primera = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    exigirEstado(primera, 201, 'primera apertura');
    const segunda = await abrirOrden(ctx, cajero, { mesaId: mesa.id });
    esperarError(segunda, 409, 'MESA_OCUPADA');
    expect(segunda.body.ordenId).toBe(primera.body.id);
    expect(await ordenesDe(mesa.id)).toHaveLength(1);
  });

  it('también con la orden en pre-cuenta', async () => {
    const mesa = await mesasS1.siguiente();
    const primera = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    await ponerEstado(api, e.A.empresaId, primera.body.id as string, 'EN_PRECUENTA');
    const segunda = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    esperarError(segunda, 409, 'MESA_OCUPADA');
    expect(segunda.body.ordenId).toBe(primera.body.id);
  });

  it('una mesa libre otra vez (orden anulada) se puede abrir de nuevo', async () => {
    const mesa = await mesasS1.siguiente();
    const primera = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    await anularPorSql(api, e.A.empresaId, primera.body.id as string);
    expect((await mesaEnSalon(ctx, mozo, mesa.id)).estado).toBe('LIBRE');
    const segunda = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    exigirEstado(segunda, 201, 'abrir otra vez');
    expect(segunda.body.id).not.toBe(primera.body.id);
    expect(await ordenesDe(mesa.id)).toHaveLength(2);
  });

  it('el índice único de la base impide dos relaciones vigentes de la misma mesa', async () => {
    const mesa = await mesasS1.siguiente();
    const primera = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
    const otra = await mesasS1.siguiente();
    const segunda = await abrirOrden(ctx, mozo, { mesaId: otra.id });
    exigirEstado(primera, 201, 'primera');
    exigirEstado(segunda, 201, 'segunda');
    const error = await enTransaccion(api, e.A.empresaId, () =>
      errorDe(
        api.query(
          `INSERT INTO orden_mesa (empresa_id, orden_id, mesa_id, desde, creado_en, actualizado_en)
           VALUES ($1, $2, $3, now(), now(), now())`,
          [e.A.empresaId, segunda.body.id, mesa.id],
        ),
      ),
    );
    expect(error.code).toBe('23505');
    expect(error.constraint).toBe('orden_mesa_vigente_unica');
  });
});

describe('criterio 12 · reintento de la apertura', () => {
  it('el mismo id y la misma mesa devuelve 201 con la orden existente en su estado actual, con cualquier clave y desde otra sesión', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    const clave = randomUUID();
    const original = await abrirOrden(ctx, mozo, { id, mesaId: mesa.id, comensales: 2 }, { clave });
    exigirEstado(original, 201, 'apertura');
    exigirEstado(
      await llamar(ctx, cajero, {
        metodo: 'patch',
        ruta: `/ordenes/${id}`,
        cuerpo: { comensales: 5 },
      }),
      200,
      'cambiar los comensales',
    );
    const mismaClave = await abrirOrden(
      ctx,
      mozo,
      { id, mesaId: mesa.id, comensales: 2 },
      { clave },
    );
    const otraClave = await abrirOrden(ctx, mozo, { id, mesaId: mesa.id, comensales: 2 });
    const otraSesion = await abrirOrden(ctx, cajero, { id, mesaId: mesa.id, comensales: 9 });
    exigirEstado(mismaClave, 201, 'misma clave');
    exigirEstado(otraClave, 201, 'otra clave');
    exigirEstado(otraSesion, 201, 'otra sesión');
    // La misma clave devuelve lo guardado; las otras, la orden como está ahora.
    expect(mismaClave.body).toEqual(original.body);
    expect(otraClave.body.comensales).toBe(5);
    expect(otraSesion.body.comensales).toBe(5);
    expect(otraSesion.body.mozo.id).toBe(e.A.mozo.id);
    expect(await ordenesDe(mesa.id)).toHaveLength(1);
    expect(await filasDe(admin, 'orden', 'id = $1', [id])).toHaveLength(1);
  });

  it('no repite efectos: ni eventos en la réplica', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    exigirEstado(await abrirOrden(ctx, mozo, { id, mesaId: mesa.id }), 201, 'apertura');
    await asentar();
    ctx.publicador.limpiar();
    exigirEstado(await abrirOrden(ctx, mozo, { id, mesaId: mesa.id }), 201, 'réplica');
    exigirEstado(await abrirOrden(ctx, cajero, { id, mesaId: mesa.id }), 201, 'réplica de otro');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('el mismo id con otra mesa, o la misma clave con otro cuerpo, responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const mesa = await mesasS1.siguiente();
    const otra = await mesasS1.siguiente();
    const id = randomUUID();
    const clave = randomUUID();
    exigirEstado(await abrirOrden(ctx, mozo, { id, mesaId: mesa.id }, { clave }), 201, 'apertura');
    esperarError(
      await abrirOrden(ctx, mozo, { id, mesaId: otra.id }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    esperarError(
      await abrirOrden(ctx, mozo, { id: randomUUID(), mesaId: otra.id }, { clave }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    expect(await ordenesDe(otra.id)).toEqual([]);
  });

  it('el mismo id con una mesa de otra sucursal activa (la misma orden vista desde S2) también es 422, no la orden', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    exigirEstado(await abrirOrden(ctx, mozo, { id, mesaId: mesa.id }), 201, 'apertura en S1');
    const desdeS2 = await abrirOrden(ctx, mozoDeS2, { id, mesaId: mesa.id });
    esperarError(desdeS2, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  });

  it('una réplica después de anular la orden devuelve la orden tal como está', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    exigirEstado(await abrirOrden(ctx, mozo, { id, mesaId: mesa.id }), 201, 'apertura');
    await anularPorSql(api, e.A.empresaId, id);
    const replica = await abrirOrden(ctx, mozo, { id, mesaId: mesa.id });
    exigirEstado(replica, 201, 'réplica');
    expect(replica.body.estado).toBe('ANULADA');
    expect(replica.body.anuladaEn).not.toBeNull();
  });
});

describe('criterio 13 · comensales', () => {
  it('PATCH cambia los comensales de una orden abierta; con el mismo número responde 200 sin evento', async () => {
    const mesa = await mesasS1.siguiente();
    const apertura = await abrirOrden(ctx, mozo, { mesaId: mesa.id, comensales: 2 });
    const id = apertura.body.id as string;
    await asentar();
    ctx.publicador.limpiar();
    const res = await llamar(ctx, cajero, {
      metodo: 'patch',
      ruta: `/ordenes/${id}`,
      cuerpo: { comensales: 7 },
    });
    exigirEstado(res, 200, 'cambiar los comensales');
    expect(ordenRespuestaSchema.parse(res.body).comensales).toBe(7);
    expect((await leerOrden(ctx, mozo, id)).comensales).toBe(7);
    await asentar();
    expect(ctx.publicador.eventos().map((x) => x.nombre)).toEqual(['orden.cambio']);
    ctx.publicador.limpiar();
    exigirEstado(
      await llamar(ctx, cajero, {
        metodo: 'patch',
        ruta: `/ordenes/${id}`,
        cuerpo: { comensales: 7 },
      }),
      200,
      'sin cambio',
    );
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('en una orden que no está abierta responde 409 ORDEN_NO_ABIERTA y no cambia nada', async () => {
    const mesa = await mesasS1.siguiente();
    const apertura = await abrirOrden(ctx, mozo, { mesaId: mesa.id, comensales: 3 });
    const id = apertura.body.id as string;
    await anularPorSql(api, e.A.empresaId, id);
    const res = await llamar(ctx, mozo, {
      metodo: 'patch',
      ruta: `/ordenes/${id}`,
      cuerpo: { comensales: 8 },
    });
    esperarError(res, 409, 'ORDEN_NO_ABIERTA');
    expect((await leerOrden(ctx, mozo, id)).comensales).toBe(3);
  });

  it('valida el cuerpo (entero de 1 a 99, un solo campo) y la orden de otra sucursal, de B o inexistente es 404', async () => {
    const mesa = await mesasS1.siguiente();
    const id = (await abrirOrden(ctx, mozo, { mesaId: mesa.id })).body.id as string;
    for (const cuerpo of [
      {},
      { comensales: 0 },
      { comensales: 100 },
      { comensales: 2.5 },
      { comensales: 3, mozoId: e.A.mozo.id },
    ]) {
      esperarError(
        await llamar(ctx, mozo, { metodo: 'patch', ruta: `/ordenes/${id}`, cuerpo }),
        400,
        'DATOS_INVALIDOS',
      );
    }
    esperarError(
      await llamar(ctx, mozoDeS2, {
        metodo: 'patch',
        ruta: `/ordenes/${id}`,
        cuerpo: { comensales: 3 },
      }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(ctx, mozoB, {
        metodo: 'patch',
        ruta: `/ordenes/${id}`,
        cuerpo: { comensales: 3 },
      }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(ctx, mozo, {
        metodo: 'patch',
        ruta: `/ordenes/${randomUUID()}`,
        cuerpo: { comensales: 3 },
      }),
      404,
      'NO_ENCONTRADO',
    );
    esperarError(
      await llamar(ctx, cocina, {
        metodo: 'patch',
        ruta: `/ordenes/${id}`,
        cuerpo: { comensales: 3 },
      }),
      403,
      'PROHIBIDO',
    );
    expect((await leerOrden(ctx, mozo, id)).comensales).toBe(2);
  });
});

describe('criterio 14 · eventos', () => {
  it('abrir publica salon.cambio y orden.cambio en la sala de la sucursal, solo después de confirmar', async () => {
    const mesa = await mesasS1.siguiente();
    const id = randomUUID();
    await asentar();
    ctx.publicador.limpiar();
    exigirEstado(await abrirOrden(ctx, mozo, { id, mesaId: mesa.id }), 201, 'apertura');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
        nombre: 'salon.cambio',
        datos: { mesaIds: [mesa.id], ordenId: id },
      },
      {
        empresaId: e.A.empresaId,
        sala: { tipo: 'sucursal', sucursalId: e.A.S1 },
        nombre: 'orden.cambio',
        datos: { ordenId: id },
      },
    ]);
  });

  it('un rechazo (mesa ocupada, mozoId inválido, mesa de otra empresa) no publica nada', async () => {
    const mesa = await mesasS1.siguiente();
    exigirEstado(await abrirOrden(ctx, mozo, { mesaId: mesa.id }), 201, 'apertura');
    const libre = await mesasS1.siguiente();
    const deB = await mesasB.siguiente();
    await asentar();
    ctx.publicador.limpiar();
    esperarError(await abrirOrden(ctx, mozo, { mesaId: mesa.id }), 409, 'MESA_OCUPADA');
    esperarError(
      await abrirOrden(ctx, mozo, { mesaId: libre.id, mozoId: e.A.cocina.id }),
      422,
      'REFERENCIA_INVALIDA',
    );
    esperarError(await abrirOrden(ctx, mozo, { mesaId: deB.id }), 404, 'NO_ENCONTRADO');
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });
});

describe('criterio 4 · desactivar una mesa con orden abierta', () => {
  it('responde 409 EN_USO mientras la orden está abierta y se puede cuando se anula', async () => {
    const mesa = await mesasS1.siguiente();
    const id = (await abrirOrden(ctx, mozo, { mesaId: mesa.id })).body.id as string;
    const desactivar = () =>
      llamar(ctx, e.A.tokenAdmin, {
        metodo: 'patch',
        ruta: `/sucursales/${e.A.S1}/mesas/${mesa.id}`,
        cuerpo: { activa: false },
      });
    esperarError(await desactivar(), 409, 'EN_USO');
    await anularPorSql(api, e.A.empresaId, id);
    exigirEstado(await desactivar(), 200, 'desactivar con la mesa libre');
  });
});

describe('criterio 55 · GET /ordenes/:id', () => {
  it('trae la orden de la sucursal activa; la de otra sucursal, la de B y una inexistente son 404 iguales', async () => {
    const mesa = await mesasS1.siguiente();
    const id = (await abrirOrden(ctx, mozo, { mesaId: mesa.id })).body.id as string;
    const orden = await leerOrden(ctx, cajero, id);
    expect(ordenRespuestaSchema.parse(orden).id).toBe(id);
    const ajenas = [
      await llamar(ctx, mozoDeS2, { metodo: 'get', ruta: `/ordenes/${id}` }),
      await llamar(ctx, mozoB, { metodo: 'get', ruta: `/ordenes/${id}` }),
      await llamar(ctx, mozo, { metodo: 'get', ruta: `/ordenes/${randomUUID()}` }),
    ];
    for (const res of ajenas) esperarError(res, 404, 'NO_ENCONTRADO');
    expect(ajenas[0]!.body).toEqual(ajenas[2]!.body);
    expect(ajenas[1]!.body).toEqual(ajenas[2]!.body);
    esperarError(
      await llamar(ctx, cocina, { metodo: 'get', ruta: `/ordenes/${id}` }),
      403,
      'PROHIBIDO',
    );
    // El salón de S1 sigue mostrándola.
    expect((await leerSalon(ctx, mozo)).zonas.length).toBeGreaterThan(0);
  });
});
