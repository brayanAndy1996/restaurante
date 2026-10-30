// Historia 004 · entrega 3b, grupo C8 (T40) · pruebas del desarrollador (no protegidas) de lo que las protegidas de
// `impresion-critica/` no recorren: la pre-cuenta en la impresora de caja (criterios 102 y 114), la página de prueba
// y la reimpresión (127 y 128), la lista de trabajos (128), el vencimiento por día operativo (117), la marca de
// retraso (118), el resultado del puente (115) y el estado y el latido (120 y 121).
import { randomUUID } from 'node:crypto';
import {
  estadoImpresionRespuestaSchema,
  precuentaRespuestaSchema,
  trabajoResumenSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirOrden,
  enviarOk,
  exigirEstado,
  lineasDe,
  llamar,
  pedirPrecuenta,
  prepararEscenarioP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { MINUTO } from '../acceso/fabrica-plataforma';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import { arrancarP5, type AppP5 } from '../impresion-critica/fabrica-p5';
import {
  crearPrueba,
  llamarPuente,
  nuevoPuente,
  trabajosDelPuente,
} from '../impresion-critica/fabrica-p6';
import { interpretarEscPos } from '../soporte/puente';
import { abrirCliente } from '../utilidades';
import { cuerpoRed, impresoraCreada, unico } from './ayudas-impresion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;

const A = () => esc.e.A;
const T = () => esc.token.adminA;

beforeAll(async () => {
  ctx = await arrancarP5();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const HORA = 60 * MINUTO;

const trabajosDe = async (sucursalId: string) =>
  (
    await admin.query<{
      id: string;
      tipo: string;
      estado: string;
      intentos: number;
      ultimo_error: string | null;
      precuenta_id: string | null;
      reimpresion_de_id: string | null;
      impresora_id: string;
      mesa: string | null;
    }>(
      `SELECT id, tipo, estado, intentos, ultimo_error, precuenta_id, reimpresion_de_id, impresora_id, mesa
         FROM trabajo_impresion WHERE sucursal_id = $1 ORDER BY creado_en, id`,
      [sucursalId],
    )
  ).rows;

const ponerCaja = async (sucursalId: string, impresoraCajaId: string | null) =>
  exigirEstado(
    await llamar(ctx, T(), {
      metodo: 'put',
      ruta: `/sucursales/${sucursalId}/impresion`,
      cuerpo: { impresoraCajaId },
    }),
    200,
    'fijar la impresora de caja',
  );

describe('pre-cuenta en la impresora de caja (criterios 102 y 114)', () => {
  it('sin impresora de caja la pre-cuenta se emite con SIN_IMPRESORA y sin trabajos; con impresora, EN_COLA y un trabajo PRECUENTA', async () => {
    const L = lineasDe(esc.carta);
    const caja = await impresoraCreada(ctx, T(), A().S2, cuerpoRed({ nombre: unico('Caja') }));
    const mozo = esc.token.mozoS2;
    const orden = await abrirOrden(ctx, esc.salonS2, mozo);
    await enviarOk(ctx, mozo, orden.id, [L.lomo(['3/4'], 1)]);

    const sin = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(sin, 201, 'pre-cuenta sin impresora de caja');
    expect(precuentaRespuestaSchema.parse(sin.body).impresion).toBe('SIN_IMPRESORA');
    expect((await trabajosDe(A().S2)).filter((t) => t.tipo === 'PRECUENTA')).toEqual([]);

    await ponerCaja(A().S2, caja.id);
    // Sin cambios en la orden, devolver la vigente imprime otra (criterio 52 y 114).
    const vigente = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(vigente, 201, 'la vigente con impresora de caja');
    const cuerpo = precuentaRespuestaSchema.parse(vigente.body);
    expect(cuerpo.impresion).toBe('EN_COLA');
    expect(cuerpo.id).toBe(precuentaRespuestaSchema.parse(sin.body).id);
    const trabajos = (await trabajosDe(A().S2)).filter((t) => t.tipo === 'PRECUENTA');
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]).toMatchObject({ precuenta_id: cuerpo.id, impresora_id: caja.id });

    // Una réplica por el mismo id, con otra clave, repite el valor de la primera respuesta sin otro trabajo.
    const replica = await pedirPrecuenta(ctx, mozo, orden.id, cuerpo.id, randomUUID());
    exigirEstado(replica, 201, 'réplica del mismo id');
    expect(precuentaRespuestaSchema.parse(replica.body).impresion).toBe('EN_COLA');
    expect((await trabajosDe(A().S2)).filter((t) => t.tipo === 'PRECUENTA')).toHaveLength(1);

    // Una nueva emisión (otro número) sale otra vez, y el ticket lleva la pre-cuenta y su total.
    await enviarOk(ctx, mozo, orden.id, [L.gaseosa(1)]);
    const nueva = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(nueva, 201, 'una pre-cuenta nueva');
    expect(precuentaRespuestaSchema.parse(nueva.body)).toMatchObject({
      numero: 2,
      impresion: 'EN_COLA',
    });
    expect((await trabajosDe(A().S2)).filter((t) => t.tipo === 'PRECUENTA')).toHaveLength(2);
    await ponerCaja(A().S2, null);
  });
});

describe('página de prueba, lista de trabajos, reimpresión y resultado', () => {
  it('la página de prueba funciona con la impresora inactiva y el ticket trae la muestra de caracteres', async () => {
    const impresora = await impresoraCreada(
      ctx,
      T(),
      A().S1,
      cuerpoRed({ juegoCaracteres: 'PC850' }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), A().S1);
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${A().S1}/impresoras/${impresora.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    const id = await crearPrueba(ctx, T(), A().S1, impresora.id);
    const entregados = (await trabajosDelPuente(ctx, puente)).filter((t) => t.id === id);
    expect(entregados).toHaveLength(1);
    const { tickets } = interpretarEscPos(Buffer.from(entregados[0]!.bytes, 'base64'), {
      columnas: 48,
    });
    expect(tickets[0]!.texto).toContain('áéíóú ÁÉÍÓÚ ñ Ñ ü ¿¡ S/ 1,234.50');
    expect(tickets[0]!.texto).toContain(impresora.nombre);
  });

  it('el resultado NO_IMPRESO suma un intento y deja el error; IMPRESO cierra el trabajo; repetirlo no cambia nada', async () => {
    const impresora = await impresoraCreada(ctx, T(), A().S1);
    const puente = await nuevoPuente(ctx, T(), A(), A().S1);
    const id = await crearPrueba(ctx, T(), A().S1, impresora.id);
    const reportar = (cuerpo: unknown) =>
      llamarPuente(ctx, puente.token, 'post', `/puente/trabajos/${id}/resultado`, cuerpo);

    expect((await reportar({ resultado: 'NO_IMPRESO', error: 'Sin papel' })).status).toBe(200);
    expect((await reportar({ resultado: 'NO_IMPRESO', error: 'Sin papel otra vez' })).status).toBe(
      200,
    );
    let fila = (await trabajosDe(A().S1)).find((t) => t.id === id)!;
    expect(fila).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 2,
      ultimo_error: 'Sin papel otra vez',
    });

    expect((await reportar({ resultado: 'IMPRESO' })).status).toBe(200);
    expect((await reportar({ resultado: 'IMPRESO' })).status).toBe(200);
    // Un fallo tardío no devuelve a la cola un trabajo ya impreso.
    expect((await reportar({ resultado: 'NO_IMPRESO', error: 'tarde' })).status).toBe(200);
    fila = (await trabajosDe(A().S1)).find((t) => t.id === id)!;
    expect(fila).toMatchObject({ estado: 'IMPRESO', intentos: 2 });
    expect((await trabajosDelPuente(ctx, puente)).map((t) => t.id)).not.toContain(id);

    // Entrada inválida: 400.
    for (const cuerpo of [
      {},
      { resultado: 'OTRO' },
      { resultado: 'NO_IMPRESO' },
      { resultado: 'IMPRESO', x: 1 },
    ]) {
      expect((await reportar(cuerpo)).status, JSON.stringify(cuerpo)).toBe(400);
    }
  });

  it('la lista de trabajos de la sucursal activa se filtra por estado y la reimpresión crea un trabajo nuevo con la marca', async () => {
    const impresora = await impresoraCreada(ctx, T(), A().S1);
    const puente = await nuevoPuente(ctx, T(), A(), A().S1);
    const id = await crearPrueba(ctx, T(), A().S1, impresora.id);
    const mozo = esc.token.mozo;

    const lista = await llamar(ctx, mozo, { metodo: 'get', ruta: '/impresion/trabajos' });
    exigirEstado(lista, 200, 'listar');
    const trabajos = z.array(trabajoResumenSchema).parse(lista.body);
    expect(trabajos.find((t) => t.id === id)).toMatchObject({
      tipo: 'PRUEBA',
      estado: 'PENDIENTE',
      mesa: null,
      impresora: { id: impresora.id, nombre: impresora.nombre },
    });
    const soloImpresos = await llamar(ctx, mozo, {
      metodo: 'get',
      ruta: '/impresion/trabajos?estado=IMPRESO',
    });
    expect(
      z
        .array(trabajoResumenSchema)
        .parse(soloImpresos.body)
        .map((t) => t.id),
    ).not.toContain(id);
    expect(
      (await llamar(ctx, mozo, { metodo: 'get', ruta: '/impresion/trabajos?estado=OTRO' })).status,
    ).toBe(400);

    // Sin Idempotency-Key, 400.
    const sinClave = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: `/impresion/trabajos/${id}/reimpresion`,
    });
    expect(sinClave.status).toBe(400);

    const clave = randomUUID();
    const reimpresion = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: `/impresion/trabajos/${id}/reimpresion`,
      cabeceras: { 'Idempotency-Key': clave },
    });
    exigirEstado(reimpresion, 201, 'reimprimir');
    const nuevoId = reimpresion.body.trabajoId as string;
    const entregados = await trabajosDelPuente(ctx, puente);
    const nuevo = entregados.find((t) => t.id === nuevoId)!;
    const { tickets } = interpretarEscPos(Buffer.from(nuevo.bytes, 'base64'), { columnas: 48 });
    expect(tickets[0]!.texto).toContain('REIMPRESIÓN');
    // El documento original queda intacto: el ticket del primero no lleva la marca.
    const original = entregados.find((t) => t.id === id)!;
    expect(
      interpretarEscPos(Buffer.from(original.bytes, 'base64'), { columnas: 48 }).tickets[0]!.texto,
    ).not.toContain('REIMPRESIÓN');
    // La misma clave devuelve el mismo trabajo, sin crear otro.
    const repetida = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: `/impresion/trabajos/${id}/reimpresion`,
      cabeceras: { 'Idempotency-Key': clave },
    });
    expect(repetida.body.trabajoId).toBe(nuevoId);
    expect((await trabajosDe(A().S1)).filter((t) => t.reimpresion_de_id === id)).toHaveLength(1);
  });

  it('reimprimir un trabajo cuya impresora está inactiva y no tiene estación es 409 SIN_IMPRESORA', async () => {
    const impresora = await impresoraCreada(ctx, T(), A().S1);
    const id = await crearPrueba(ctx, T(), A().S1, impresora.id);
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${A().S1}/impresoras/${impresora.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    const res = await llamar(ctx, esc.token.mozo, {
      metodo: 'post',
      ruta: `/impresion/trabajos/${id}/reimpresion`,
      cabeceras: { 'Idempotency-Key': randomUUID() },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'SIN_IMPRESORA' });
  });
});

describe('estado del puente y de las impresoras (criterios 120 y 121)', () => {
  it('sin puente todo es DESCONOCIDO; con latido, LISTA; sin señal por más de 60 segundos el puente está desconectado', async () => {
    const S3 = A().S3!;
    const tokenS3 = await sesionContrasena(ctx, A().base.admin, S3);
    const impresora = await impresoraCreada(ctx, T(), S3);
    const pedir = async () => {
      const res = await llamar(ctx, tokenS3, { metodo: 'get', ruta: '/impresion/estado' });
      exigirEstado(res, 200, 'estado');
      return estadoImpresionRespuestaSchema.parse(res.body);
    };
    let estado = await pedir();
    expect(estado.puente).toBeNull();
    expect(estado.impresoras).toEqual([
      {
        id: impresora.id,
        nombre: impresora.nombre,
        estado: 'DESCONOCIDO',
        estadoDesde: null,
        pendientes: 0,
      },
    ]);

    const puente = await nuevoPuente(ctx, T(), A(), S3);
    await crearPrueba(ctx, T(), S3, impresora.id);
    ctx.reloj.avanzar(1000);
    const latido = await llamarPuente(ctx, puente.token, 'post', '/puente/latido', {
      versionApp: '1.0.0',
      impresoras: [{ id: impresora.id, estado: 'LISTA' }],
    });
    expect(latido.status).toBe(204);
    estado = await pedir();
    expect(estado.puente).toMatchObject({ id: puente.id, conectado: true });
    expect(estado.impresoras[0]).toMatchObject({ estado: 'LISTA', pendientes: 1 });
    expect(estado.impresoras[0]!.estadoDesde).toBe(ctx.reloj.ahora().toISOString());

    ctx.reloj.avanzar(61 * 1000);
    estado = await pedir();
    expect(estado.puente?.conectado).toBe(false);
    expect(estado.impresoras[0]).toMatchObject({ estado: 'DESCONOCIDO', pendientes: 1 });
    expect(Date.parse(estado.ahora)).toBe(ctx.reloj.ahora().getTime());
  });
});

// Va al final: avanza el reloj dos días y las sesiones de los demás casos vencen.
describe('retraso y vencimiento por día operativo (criterios 117 y 118)', () => {
  it('un trabajo entregado a los 3 minutos lleva la marca de retraso; a los 2 no; y pasado el día operativo vence', async () => {
    const impresora = await impresoraCreada(ctx, T(), A().S1);
    const puente = await nuevoPuente(ctx, T(), A(), A().S1);
    const pronto = await crearPrueba(ctx, T(), A().S1, impresora.id);
    ctx.reloj.avanzar(2 * MINUTO);
    const alDia = (await trabajosDelPuente(ctx, puente)).find((t) => t.id === pronto)!;
    const texto = (b: string) =>
      interpretarEscPos(Buffer.from(b, 'base64'), { columnas: 48 }).tickets[0]!.texto;
    expect(texto(alDia.bytes)).not.toContain('Impreso con retraso');

    ctx.reloj.avanzar(MINUTO + 1000);
    const tarde = (await trabajosDelPuente(ctx, puente)).find((t) => t.id === pronto)!;
    expect(texto(tarde.bytes)).toMatch(/Impreso con retraso · enviado a las \d\d:\d\d/);

    // Dos días después el pendiente venció: no se entrega, su resultado es 409 y la lista lo muestra VENCIDO.
    ctx.reloj.avanzar(48 * HORA);
    expect((await trabajosDelPuente(ctx, puente)).map((t) => t.id)).not.toContain(pronto);
    const res = await llamarPuente(
      ctx,
      puente.token,
      'post',
      `/puente/trabajos/${pronto}/resultado`,
      {
        resultado: 'IMPRESO',
      },
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ codigo: 'TRANSICION_INVALIDA' });
    const desde = new Date(ctx.reloj.ahora().getTime() - 72 * HORA).toISOString();
    // Las sesiones de antes vencieron con el reloj: una nueva.
    const lista = await llamar(ctx, await sesionContrasena(ctx, A().mozo, A().S1), {
      metodo: 'get',
      ruta: `/impresion/trabajos?desde=${encodeURIComponent(desde)}&estado=VENCIDO`,
    });
    exigirEstado(lista, 200, 'listar vencidos');
    expect(
      z
        .array(trabajoResumenSchema)
        .parse(lista.body)
        .map((t) => t.id),
    ).toContain(pronto);
  });
});
