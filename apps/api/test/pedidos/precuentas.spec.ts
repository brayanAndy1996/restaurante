// Historia 004 · salón y cocina, grupo C6 (T26) · pruebas del desarrollador (no protegidas) de la pre-cuenta
// (criterios 50 a 54). Completan `salon-critica/montos-orden.spec.ts` (total, notas y desglose) con la réplica
// por id, la vigente que se devuelve sin cambios, el número siguiente, el estado de la orden, los eventos, la
// concurrencia y los rechazos.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  PoolDeMesas,
  abrirOrden,
  arrancarP3,
  asentar,
  auditoriaSalon,
  cabeceras,
  crearEscenarioP3,
  enviar,
  esperarError,
  eventosDe,
  exigirEstado,
  filasDe,
  leerOrden,
  leerSalon,
  lineaCombo,
  lineaGaseosa,
  lineaLomo,
  llamar,
  pedirPrecuenta,
  sembrarCartaSalon,
  sesiones,
  type AppP3,
  type CartaSalon,
  type EscenarioP3,
} from '../salon-critica/fabrica-p3';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let ctx: AppP3;
let e: EscenarioP3;
let admin: Client;
let carta: CartaSalon;
let mesas: PoolDeMesas;
let mozo: string;
let cocina: string;
let supervisor: string;

beforeAll(async () => {
  ctx = await arrancarP3({ poolMax: 4 });
  admin = await abrirCliente('admin');
  e = await crearEscenarioP3(ctx);
  carta = await sembrarCartaSalon(ctx, e.A.tokenAdmin);
  mesas = new PoolDeMesas(ctx, e.A.tokenAdmin, e.A.S1);
  mozo = (await sesiones(ctx, e.A.mozo, e.A.S1)).contrasena;
  cocina = (await sesiones(ctx, e.A.cocina, e.A.S1)).contrasena;
  supervisor = (await sesiones(ctx, e.A.supervisor, e.A.S1)).contrasena;
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

/** Abre una mesa nueva y, con `conItems`, envía el lomo × 2 y la gaseosa × 2 (`"61.00"` + `"18.00"`). */
async function abrir(conItems = true): Promise<{ id: string; mesaId: string; itemIds: string[] }> {
  const mesa = await mesas.siguiente();
  const res = await abrirOrden(ctx, mozo, { mesaId: mesa.id });
  exigirEstado(res, 201, 'abrir la mesa');
  const id = res.body.id as string;
  let itemIds: string[] = [];
  if (conItems) {
    const envio = await enviar(ctx, mozo, id, [lineaLomo(carta, 2), lineaGaseosa(carta, 2)]);
    exigirEstado(envio, 201, 'enviar');
    itemIds = (envio.body.items as { id: string }[]).map((i) => i.id);
  }
  return { id, mesaId: mesa.id, itemIds };
}

const precuentasDe = (ordenId: string) =>
  filasDe(admin, 'precuenta', 'orden_id = $1', [ordenId]) as Promise<
    {
      id: string;
      numero: number;
      invalidada_en: Date | null;
      version_orden: number;
      total: string;
    }[]
  >;

describe('criterio 50 · emitir', () => {
  it('responde 201 con la forma de la respuesta, deja la orden EN_PRECUENTA y la mesa en amarillo', async () => {
    const o = await abrir();
    await asentar();
    ctx.publicador.limpiar();
    const res = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(res, 201, 'pedir la pre-cuenta');
    expect(res.body).toMatchObject({
      numero: 1,
      total: '79.00',
      nota: 'Precios con IGV incluido. No es un comprobante de pago.',
      orden: { id: o.id, comensales: 2, mozo: { id: e.A.mozo.id } },
    });
    expect(res.body.orden.mesas).toHaveLength(1);
    expect(res.body.lineas).toEqual([
      {
        itemId: o.itemIds[0],
        nombre: 'Lomo saltado',
        modificadores: expect.arrayContaining(['3/4', 'Huevo']),
        cantidad: 2,
        precioUnitario: '30.50',
        total: '61.00',
      },
      {
        itemId: o.itemIds[1],
        nombre: 'Gaseosa 1 L',
        modificadores: [],
        cantidad: 2,
        precioUnitario: '9.00',
        total: '18.00',
      },
    ]);
    expect(new Date(res.body.emitidaEn).toISOString()).toBe(res.body.emitidaEn);
    expect((await leerOrden(ctx, mozo, o.id)).estado).toBe('EN_PRECUENTA');
    const mesa = (await leerSalon(ctx, mozo)).zonas
      .flatMap((z) => z.mesas)
      .find((m) => m.id === o.mesaId)!;
    expect(mesa.estado).toBe('EN_PRECUENTA');

    await asentar();
    expect(eventosDe(ctx, 'salon.cambio')).toHaveLength(1);
    expect(eventosDe(ctx, 'orden.cambio')).toHaveLength(1);
    // La pre-cuenta no se audita ni toca el inventario.
    expect(await auditoriaSalon(admin, e.A.empresaId, { entidadId: o.id })).toEqual([]);
  });

  it('exige Idempotency-Key (400) y un cuerpo estricto con id (400); Cocina/Barra, 403', async () => {
    const o = await abrir();
    const sinClave = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/precuentas`,
      cuerpo: { id: randomUUID() },
    });
    esperarError(sinClave, 400, 'DATOS_INVALIDOS');
    for (const cuerpo of [{}, { id: 'no-es-uuid' }, { id: randomUUID(), extra: 1 }]) {
      esperarError(
        await llamar(ctx, mozo, {
          metodo: 'post',
          ruta: `/ordenes/${o.id}/precuentas`,
          cuerpo,
          cabeceras: cabeceras(),
        }),
        400,
        'DATOS_INVALIDOS',
      );
    }
    esperarError(await pedirPrecuenta(ctx, cocina, o.id), 403, 'PROHIBIDO');
    expect(await precuentasDe(o.id)).toEqual([]);
  });

  it('sin ítems con cantidad vigente responde 409 ORDEN_SIN_CONSUMO y no cambia nada', async () => {
    const vacia = await abrir(false);
    esperarError(await pedirPrecuenta(ctx, mozo, vacia.id), 409, 'ORDEN_SIN_CONSUMO');
    expect((await leerOrden(ctx, mozo, vacia.id)).estado).toBe('ABIERTA');

    // Con todo anulado tampoco hay nada que mostrar.
    const anulada = await abrir();
    for (const itemId of anulada.itemIds) {
      exigirEstado(
        await llamar(ctx, supervisor, {
          metodo: 'post',
          ruta: `/ordenes/${anulada.id}/items/${itemId}/anulaciones`,
          cuerpo: {
            id: randomUUID(),
            cantidad: 2,
            motivo: 'Error de toma',
            destinoStock: 'VUELVE',
          },
          cabeceras: cabeceras(),
        }),
        201,
        'anular el ítem',
      );
    }
    esperarError(await pedirPrecuenta(ctx, mozo, anulada.id), 409, 'ORDEN_SIN_CONSUMO');
    expect(await precuentasDe(anulada.id)).toEqual([]);
    expect(await precuentasDe(vacia.id)).toEqual([]);
  });

  it('una orden anulada responde 409 ORDEN_NO_ABIERTA; una unida, con el ordenId de la principal; una de otra sucursal, 404', async () => {
    const anulada = await abrir();
    exigirEstado(
      await llamar(ctx, supervisor, {
        metodo: 'post',
        ruta: `/ordenes/${anulada.id}/anulacion`,
        cuerpo: { motivo: 'Prueba', destinoStock: 'VUELVE' },
        cabeceras: cabeceras(),
      }),
      200,
      'anular la orden',
    );
    esperarError(await pedirPrecuenta(ctx, mozo, anulada.id), 409, 'ORDEN_NO_ABIERTA');

    const principal = await abrir();
    const absorbida = await abrir();
    exigirEstado(
      await llamar(ctx, mozo, {
        metodo: 'post',
        ruta: `/ordenes/${principal.id}/union`,
        cuerpo: { mesaIds: [absorbida.mesaId] },
      }),
      200,
      'unir',
    );
    const unida = await pedirPrecuenta(ctx, mozo, absorbida.id);
    esperarError(unida, 409, 'ORDEN_NO_ABIERTA');
    expect(unida.body.ordenId).toBe(principal.id);

    esperarError(await pedirPrecuenta(ctx, mozo, randomUUID()), 404, 'NO_ENCONTRADO');
  });
});

describe('criterio 52 · repetir', () => {
  it('con otro id y otra clave devuelve la vigente (mismo id y número), sin otra fila ni otros eventos', async () => {
    const o = await abrir();
    const primera = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(primera, 201, 'primera');
    await asentar();
    ctx.publicador.limpiar();
    const otra = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(otra, 201, 'repetida');
    expect(otra.body).toEqual(primera.body);
    expect(await precuentasDe(o.id)).toHaveLength(1);
    await asentar();
    expect(ctx.publicador.eventos()).toEqual([]);
  });

  it('el mismo id vuelve a dar la misma, también después de que la orden cambió', async () => {
    const o = await abrir();
    const id = randomUUID();
    const primera = await pedirPrecuenta(ctx, mozo, o.id, { id });
    exigirEstado(primera, 201, 'primera');
    exigirEstado(await enviar(ctx, mozo, o.id, [lineaGaseosa(carta, 1)]), 201, 'adición');
    const replica = await pedirPrecuenta(ctx, mozo, o.id, { id });
    exigirEstado(replica, 201, 'réplica');
    expect(replica.body.id).toBe(id);
    expect(replica.body.numero).toBe(1);
    expect(replica.body.total).toBe('79.00');
    expect(replica.body.lineas).toEqual(primera.body.lineas);
    // La orden sigue ABIERTA: la réplica no emite otra ni la vuelve a poner EN_PRECUENTA.
    expect((await leerOrden(ctx, mozo, o.id)).estado).toBe('ABIERTA');
    expect(await precuentasDe(o.id)).toHaveLength(1);
  });

  it('el mismo id en otra orden es 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const a = await abrir();
    const b = await abrir();
    const id = randomUUID();
    exigirEstado(await pedirPrecuenta(ctx, mozo, a.id, { id }), 201, 'en la primera orden');
    esperarError(
      await pedirPrecuenta(ctx, mozo, b.id, { id }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    expect(await precuentasDe(b.id)).toEqual([]);
    expect((await leerOrden(ctx, mozo, b.id)).estado).toBe('ABIERTA');
  });

  it('la misma Idempotency-Key devuelve la misma respuesta sin emitir otra', async () => {
    const o = await abrir();
    const clave = randomUUID();
    const id = randomUUID();
    const ruta = `/ordenes/${o.id}/precuentas`;
    const primera = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta,
      cuerpo: { id },
      cabeceras: cabeceras(clave),
    });
    const segunda = await llamar(ctx, mozo, {
      metodo: 'post',
      ruta,
      cuerpo: { id },
      cabeceras: cabeceras(clave),
    });
    exigirEstado(primera, 201, 'primera');
    exigirEstado(segunda, 201, 'misma clave');
    expect(segunda.body).toEqual(primera.body);
    expect(await precuentasDe(o.id)).toHaveLength(1);
  });

  it('diez pedidos a la vez con ids distintos emiten una sola pre-cuenta y todos devuelven la misma', async () => {
    const o = await abrir();
    await asentar();
    ctx.publicador.limpiar();
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () => pedirPrecuenta(ctx, mozo, o.id)),
    );
    for (const r of respuestas) exigirEstado(r, 201, 'pre-cuenta concurrente');
    expect(new Set(respuestas.map((r) => r.body.id)).size).toBe(1);
    expect(new Set(respuestas.map((r) => r.body.numero))).toEqual(new Set([1]));
    expect(await precuentasDe(o.id)).toHaveLength(1);
    await asentar();
    expect(eventosDe(ctx, 'salon.cambio')).toHaveLength(1);
    expect(eventosDe(ctx, 'orden.cambio')).toHaveLength(1);
  });
});

describe('criterio 53 · invalidación y número siguiente', () => {
  it('una adición la invalida: la orden vuelve a ABIERTA y la siguiente lleva el número 2 con el total nuevo', async () => {
    const o = await abrir();
    const primera = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(primera, 201, 'primera');
    exigirEstado(await enviar(ctx, mozo, o.id, [lineaCombo(carta, 1)]), 201, 'adición');
    const orden = await leerOrden(ctx, mozo, o.id);
    expect(orden.estado).toBe('ABIERTA');
    expect(orden.precuentaVigente).toBeNull();

    const segunda = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(segunda, 201, 'segunda');
    expect(segunda.body.numero).toBe(2);
    expect(segunda.body.id).not.toBe(primera.body.id);
    expect(segunda.body.total).toBe('106.40');
    expect(segunda.body.lineas).toHaveLength(3);
    const filas = (await precuentasDe(o.id)).sort((a, b) => a.numero - b.numero);
    expect(filas.map((f) => [f.numero, f.invalidada_en !== null])).toEqual([
      [1, true],
      [2, false],
    ]);
    // La pre-cuenta de antes conserva su total y sus líneas.
    expect(filas[0]!.total).toBe('79.00');
  });

  it('pedirla sin cambios no la invalida y cambiar los comensales tampoco', async () => {
    const o = await abrir();
    const primera = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(primera, 201, 'primera');
    exigirEstado(
      await llamar(ctx, mozo, {
        metodo: 'patch',
        ruta: `/ordenes/${o.id}`,
        cuerpo: { comensales: 5 },
      }),
      200,
      'cambiar los comensales',
    );
    const otra = await pedirPrecuenta(ctx, mozo, o.id);
    expect(otra.body.id).toBe(primera.body.id);
    expect(otra.body.orden.comensales).toBe(5);
    expect((await leerOrden(ctx, mozo, o.id)).estado).toBe('EN_PRECUENTA');
  });

  it('guarda la versión de la orden con la que se emitió', async () => {
    const o = await abrir();
    const res = await pedirPrecuenta(ctx, mozo, o.id);
    exigirEstado(res, 201, 'pedir');
    const [orden] = await filasDe(admin, 'orden', 'id = $1', [o.id]);
    const [fila] = await precuentasDe(o.id);
    expect(fila!.version_orden).toBe(orden!.version);
  });
});
