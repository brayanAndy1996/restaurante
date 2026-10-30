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
  unirMesasOk,
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
      orden_id: string | null;
      envio_numero: number | null;
    }>(
      `SELECT id, tipo, estado, intentos, ultimo_error, precuenta_id, reimpresion_de_id, impresora_id, mesa,
              orden_id, envio_numero
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
  it('sin impresora de caja: SIN_IMPRESORA y sin trabajo; con impresora, solo la pre-cuenta nueva crea un trabajo y la vigente y la réplica devuelven el suyo', async () => {
    const L = lineasDe(esc.carta);
    const caja = await impresoraCreada(ctx, T(), A().S2, cuerpoRed({ nombre: unico('Caja') }));
    const mozo = esc.token.mozoS2;
    const orden = await abrirOrden(ctx, esc.salonS2, mozo);
    await enviarOk(ctx, mozo, orden.id, [L.lomo(['3/4'], 1)]);
    const deCaja = async () => (await trabajosDe(A().S2)).filter((t) => t.tipo === 'PRECUENTA');

    const sin = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(sin, 201, 'pre-cuenta sin impresora de caja');
    expect(precuentaRespuestaSchema.parse(sin.body)).toMatchObject({
      impresion: 'SIN_IMPRESORA',
      trabajoId: null,
    });
    expect(await deCaja()).toEqual([]);

    // La vigente, ya con impresora de caja, no crea un trabajo: el de su emisión no existe, sigue sin papel.
    await ponerCaja(A().S2, caja.id);
    const vigenteSin = await pedirPrecuenta(ctx, mozo, orden.id);
    expect(precuentaRespuestaSchema.parse(vigenteSin.body)).toMatchObject({
      impresion: 'SIN_IMPRESORA',
      trabajoId: null,
    });
    expect(await deCaja()).toEqual([]);

    // Una pre-cuenta nueva (la orden cambió) crea exactamente un trabajo, con la orden y sin envío.
    await enviarOk(ctx, mozo, orden.id, [L.gaseosa(1)]);
    const nueva = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(nueva, 201, 'una pre-cuenta nueva');
    const cuerpo = precuentaRespuestaSchema.parse(nueva.body);
    expect(cuerpo).toMatchObject({ numero: 2, impresion: 'EN_COLA' });
    const trabajos = await deCaja();
    expect(trabajos).toHaveLength(1);
    expect(trabajos[0]).toMatchObject({
      id: cuerpo.trabajoId,
      precuenta_id: cuerpo.id,
      impresora_id: caja.id,
      orden_id: orden.id,
      envio_numero: null,
    });

    // La vigente sin cambios y la réplica (mismo id, otra clave) devuelven el trabajo de su emisión, sin otro.
    for (const res of [
      await pedirPrecuenta(ctx, mozo, orden.id),
      await pedirPrecuenta(ctx, mozo, orden.id, cuerpo.id, randomUUID()),
    ]) {
      exigirEstado(res, 201, 'vigente o réplica');
      expect(precuentaRespuestaSchema.parse(res.body)).toMatchObject({
        id: cuerpo.id,
        impresion: 'EN_COLA',
        trabajoId: cuerpo.trabajoId,
      });
    }
    expect(await deCaja()).toHaveLength(1);

    // "Imprimir otra vez" es reimprimir ese trabajo.
    const otra = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: `/impresion/trabajos/${cuerpo.trabajoId}/reimpresion`,
      cabeceras: { 'Idempotency-Key': randomUUID() },
    });
    exigirEstado(otra, 201, 'reimprimir la pre-cuenta');
    expect(await deCaja()).toHaveLength(2);
    await ponerCaja(A().S2, null);
  });
});

describe('orden y número de envío de los trabajos (criterio 128)', () => {
  it('la lista trae la orden y el número de envío de cada comanda, y la orden principal si la de origen se unió a otra', async () => {
    const L = lineasDe(esc.carta);
    const cocina = await impresoraCreada(ctx, T(), A().S1, cuerpoRed({ nombre: unico('Cocina') }));
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S1}/estaciones-destino/${esc.carta.cocinaId}`,
        cuerpo: { destino: 'IMPRESORA', impresoraId: cocina.id },
      }),
      200,
      'Cocina a la impresora',
    );
    const mozo = esc.token.mozo;
    try {
      const principal = await abrirOrden(ctx, esc.salon, mozo);
      const absorbida = await abrirOrden(ctx, esc.salon, mozo);
      await enviarOk(ctx, mozo, principal.id, [L.lomo(['3/4'], 1)]);
      await enviarOk(ctx, mozo, principal.id, [L.lomo(['Jugoso'], 1)]);
      await enviarOk(ctx, mozo, absorbida.id, [L.lomo(['Bien cocido'], 1)]);

      const pedir = async () => {
        const res = await llamar(ctx, mozo, { metodo: 'get', ruta: '/impresion/trabajos' });
        exigirEstado(res, 200, 'listar');
        return z.array(trabajoResumenSchema).parse(res.body);
      };
      let lista = await pedir();
      const de = (ordenId: string) =>
        lista
          .filter((t) => t.ordenId === ordenId)
          .map((t) => [t.tipo, t.envioNumero])
          .sort();
      expect(de(principal.id)).toEqual([
        ['ADICION', 2],
        ['COMANDA', 1],
      ]);
      expect(de(absorbida.id)).toEqual([['COMANDA', 1]]);

      // Al unir, la cuenta es la principal: los tickets de la absorbida salen con su orden y su envío.
      await unirMesasOk(ctx, mozo, principal.id, [absorbida.mesaId]);
      lista = await pedir();
      expect(de(absorbida.id)).toEqual([]);
      expect(de(principal.id)).toEqual([
        ['ADICION', 2],
        ['COMANDA', 1],
        ['COMANDA', 1],
      ]);
      expect(lista.every((t) => t.ordenId !== null || t.tipo === 'PRUEBA')).toBe(true);
    } finally {
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S1}/estaciones-destino/${esc.carta.cocinaId}`,
        cuerpo: { destino: 'KDS' },
      });
    }
  });
});

describe('página de prueba, lista de trabajos, reimpresión y resultado', () => {
  it('la página de prueba se crea con la impresora inactiva, no se entrega mientras lo esté y sale al activarla (criterio 127)', async () => {
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
    // Inactiva: el trabajo espera (criterio 113), no se entrega.
    expect((await trabajosDelPuente(ctx, puente)).filter((t) => t.id === id)).toHaveLength(0);
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${A().S1}/impresoras/${impresora.id}`,
        cuerpo: { activa: true },
      }),
      200,
      'activar',
    );
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
