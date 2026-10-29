// spec: 004-salon-cocina (pruebas protegidas)
//
// P2 · Punto de enganche del inventario · Criterios 39 y 72 (decisión 2): el envío, la anulación de un ítem
// (total y parcial) y la anulación de una orden llaman al puerto `INVENTARIO` exactamente una vez, dentro de su
// transacción, con las partes de stock que calcula `packages/dominio`; nunca en una réplica; y si el puerto
// lanza, la respuesta es ese error y nada queda guardado ni publicado.
//
// La API real corre con un `InventarioDePrueba` que registra cada llamada y puede lanzar. Las anulaciones las
// hace el Supervisor, que no necesita clave (criterio 36). La carta es la de ejemplo de `spec.md`.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  agotar,
  anularItemOk,
  anularOrdenOk,
  arrancarP2,
  asentar,
  clave,
  comandasDeOrden,
  conEventos,
  conteoDeOrden,
  enviarComanda,
  enviarOk,
  envio,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  llamar,
  pedirPrecuenta,
  prepararEscenarioP2,
  reactivar,
  verOrden,
  type AppP2,
  type EnvioRespuestaDePrueba,
  type EscenarioP2,
  type LineaCuerpo,
  type OrdenAbierta,
} from './fabrica-p2';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let esc: EscenarioP2;
let L: ReturnType<typeof lineasDe>;

const A = () => esc.e.A;
const t = () => esc.token;
const carta = () => esc.carta;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
  ctx.inventario.lanzarAlEnviar(null);
  ctx.inventario.lanzarAlAnular(null);
  ctx.inventario.limpiar();
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const abrir = (): Promise<OrdenAbierta> => abrirOrden(ctx, esc.salon, t().mozo);

// ---------------------------------------------------------------------------------------------------
// Las partes de stock de la carta de ejemplo
// ---------------------------------------------------------------------------------------------------

type Control = 'PORCIONES' | 'UNIDADES';
interface Parte {
  productoId: string;
  nombre: string;
  cantidad: number;
  tipoControlStock: Control;
}

const parte = (productoId: string, nombre: string, cantidad: number, c: Control): Parte => ({
  productoId,
  nombre,
  cantidad,
  tipoControlStock: c,
});

const P = {
  hamburguesa: (n: number) => parte(carta().hamburguesa, 'Hamburguesa clásica', n, 'PORCIONES'),
  cerveza: (n: number) => parte(carta().cervezaPilsen, 'Cerveza Pilsen', n, 'UNIDADES'),
  huevo: (n: number) => parte(carta().huevoFrito, 'Huevo frito', n, 'UNIDADES'),
  gaseosa: (n: number) => parte(carta().gaseosa, 'Gaseosa 1 L', n, 'UNIDADES'),
  menu: (n: number) => parte(carta().menu, 'Menú del día', n, 'PORCIONES'),
  refresco: (n: number) => parte(carta().refresco, 'Refresco del día', n, 'PORCIONES'),
  sopa: (n: number) => parte(carta().sopaDeCasa, 'Sopa de casa', n, 'PORCIONES'),
  aji: (n: number) => parte(carta().ajiDeGallina, 'Ají de gallina', n, 'PORCIONES'),
};

/** Las partes sin importar el orden (la suma por producto es lo que fija la especificación). */
const sinOrden = (partes: readonly Parte[]): Parte[] =>
  [...partes].sort((a, b) => a.productoId.localeCompare(b.productoId));

const llamadasAEnviar = () =>
  ctx.inventario.alEnviarLlamadas().map((l) => ({ ...l, partes: sinOrden(l.partes as Parte[]) }));
const llamadasAAnular = () =>
  ctx.inventario.alAnularLlamadas().map((l) => ({ ...l, partes: sinOrden(l.partes as Parte[]) }));

const errorDelPuerto = () =>
  new ErrorAplicacion(409, 'CONFLICTO', 'No alcanza el stock (simulado)');

const ordenDe = async (ordenId: string) => {
  const res = await verOrden(ctx, t().mozo, ordenId);
  exigirEstado(res, 200, 'GET /ordenes/:id');
  return res.body as {
    estado: string;
    items: { id: string; cantidadAnulada: number; cantidadVigente: number; estado: string }[];
    precuentaVigente: { numero: number } | null;
  };
};

/** Cuántas filas de auditoría de una acción tiene la empresa. */
async function auditoriasDe(accion: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = $1 AND accion = $2`,
    [A().empresaId, accion],
  );
  return rows[0]!.n;
}

/** Anulación de un ítem por el Supervisor, sin comprobar el resultado. */
const anularItem = (
  token: string,
  ordenId: string,
  itemId: string,
  cuerpo: unknown,
  k: string = randomUUID(),
) =>
  llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/items/${itemId}/anulaciones`,
    cuerpo,
    cabeceras: clave(k),
  });

const anularOrden = (token: string, ordenId: string, cuerpo: unknown, k: string = randomUUID()) =>
  llamar(ctx, token, {
    metodo: 'post',
    ruta: `/ordenes/${ordenId}/anulacion`,
    cuerpo,
    cabeceras: clave(k),
  });

// ===================================================================================================
// El envío
// ===================================================================================================

describe('criterio 72 · el envío llama al puerto una vez, con la suma de partesDeStock de sus líneas', () => {
  it('el ejemplo del criterio 22: Hamburguesa 3, Cerveza 3, Huevo frito 1 y Gaseosa 2 (el lomo y el combo no llevan control)', async () => {
    const o = await abrir();
    const cuerpo = envio([
      L.combo(['Cerveza', 'Ensalada'], 3),
      L.lomo(['3/4', 'Huevo'], 1),
      L.gaseosa(2),
    ]);
    const res = await enviarComanda(ctx, t().mozo, o.id, cuerpo);
    exigirEstado(res, 201, 'enviar');
    expect(ctx.inventario.llamadas().map((l) => l.metodo)).toEqual(['alEnviar']);
    expect(llamadasAEnviar()).toEqual([
      {
        sucursalId: A().S1,
        envioId: cuerpo.id,
        partes: sinOrden([P.hamburguesa(3), P.cerveza(3), P.huevo(1), P.gaseosa(2)]),
      },
    ]);
  });

  it('el menú del día: el menú, el refresco, la sopa y el segundo, todos por porciones', async () => {
    const o = await abrir();
    const cuerpo = envio([L.menu(['Sopa', 'Ají de gallina'], 2)]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo), 201, 'enviar');
    expect(llamadasAEnviar()).toEqual([
      {
        sucursalId: A().S1,
        envioId: cuerpo.id,
        partes: sinOrden([P.menu(2), P.refresco(2), P.sopa(2), P.aji(2)]),
      },
    ]);
  });

  it('varias líneas del mismo producto se suman en una sola parte', async () => {
    const o = await abrir();
    const cuerpo = envio([
      L.lomo(['3/4', 'Huevo'], 1),
      L.lomo(['Jugoso', 'Huevo'], 2),
      L.combo(['Cerveza', 'Papas'], 1),
      L.combo(['Cerveza', 'Ensalada'], 2),
    ]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo), 201, 'enviar');
    expect(llamadasAEnviar()).toEqual([
      {
        sucursalId: A().S1,
        envioId: cuerpo.id,
        partes: sinOrden([P.huevo(3), P.hamburguesa(3), P.cerveza(3)]),
      },
    ]);
  });

  it('un envío sin nada con control de stock llama una vez, con la lista de partes vacía', async () => {
    const o = await abrir();
    const cuerpo = envio([L.lomo(['3/4'], 2)]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo), 201, 'enviar');
    expect(llamadasAEnviar()).toEqual([{ sucursalId: A().S1, envioId: cuerpo.id, partes: [] }]);
  });

  it('cada envío, también una adición, llama una vez con su propio id', async () => {
    const o = await abrir();
    const primero = envio([L.gaseosa(1)]);
    const adicion = envio([L.gaseosa(2)]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, primero), 201, 'comanda');
    exigirEstado(await enviarComanda(ctx, t().mozo2, o.id, adicion), 201, 'adición');
    expect(llamadasAEnviar()).toEqual([
      { sucursalId: A().S1, envioId: primero.id, partes: [P.gaseosa(1)] },
      { sucursalId: A().S1, envioId: adicion.id, partes: [P.gaseosa(2)] },
    ]);
  });

  it('una orden de la otra sucursal (S2) llama con el id de su sucursal', async () => {
    const o = await abrirOrden(ctx, esc.salonS2, t().mozoS2);
    // La carta de S2 es la misma carta de la empresa.
    const cuerpo = envio([L.gaseosa(1)]);
    exigirEstado(await enviarComanda(ctx, t().mozoS2, o.id, cuerpo), 201, 'enviar en S2');
    expect(llamadasAEnviar()).toEqual([
      { sucursalId: A().S2, envioId: cuerpo.id, partes: [P.gaseosa(1)] },
    ]);
  });
});

describe('criterio 72 · nunca en una réplica ni en un rechazo', () => {
  it('ni con la misma clave, ni con el mismo id y otra clave, ni con el mismo id desde otra sesión', async () => {
    const o = await abrir();
    const cuerpo = envio([L.combo(['Cerveza', 'Ensalada'], 1)]);
    const k = randomUUID();
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo, k), 201, 'primer envío');
    expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(1);
    for (const replica of [
      () => enviarComanda(ctx, t().mozo, o.id, cuerpo, k),
      () => enviarComanda(ctx, t().mozo, o.id, cuerpo),
      () => enviarComanda(ctx, t().mozo2, o.id, cuerpo),
    ]) {
      expect((await replica()).status).toBe(201);
    }
    expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(1);
  });

  it('ni con el mismo id después de anular la orden', async () => {
    const o = await abrir();
    const cuerpo = envio([L.lomo(['3/4', 'Huevo'], 1)]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo), 201, 'envío');
    await anularOrdenOk(ctx, t().supervisor, o.id);
    ctx.inventario.limpiar();
    expect((await enviarComanda(ctx, t().mozo, o.id, cuerpo)).status).toBe(201);
    expect(ctx.inventario.llamadas()).toEqual([]);
  });

  it('ni con el mismo id después de agotar el producto', async () => {
    const o = await abrir();
    const cuerpo = envio([L.gaseosa(2)]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, cuerpo), 201, 'envío');
    await agotar(ctx, t().cocina, carta().gaseosa);
    try {
      ctx.inventario.limpiar();
      expect((await enviarComanda(ctx, t().mozo, o.id, cuerpo)).status).toBe(201);
      expect(ctx.inventario.llamadas()).toEqual([]);
    } finally {
      await reactivar(ctx, t().cocina, carta().gaseosa);
    }
  });

  it('ni en un envío rechazado (datos, producto no vendible, orden no abierta, id reutilizado)', async () => {
    const o = await abrir();
    const bueno = envio([L.gaseosa(1)]);
    exigirEstado(await enviarComanda(ctx, t().mozo, o.id, bueno), 201, 'envío');
    ctx.inventario.limpiar();
    esperarError(
      await enviarComanda(ctx, t().mozo, o.id, { id: randomUUID() }),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await enviarComanda(ctx, t().mozo, o.id, envio([L.lomo([])])),
      422,
      'SELECCION_INVALIDA',
    );
    esperarError(
      await enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(5)], bueno.id)),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    await anularOrdenOk(ctx, t().supervisor, o.id);
    ctx.inventario.limpiar();
    esperarError(
      await enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)])),
      409,
      'ORDEN_NO_ABIERTA',
    );
    expect(ctx.inventario.llamadas()).toEqual([]);
  });

  it('diez réplicas simultáneas del mismo envío llaman una sola vez', async () => {
    const o = await abrir();
    const cuerpo = envio([L.combo(['Cerveza', 'Ensalada'], 2), L.gaseosa(1)]);
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, () => enviarComanda(ctx, t().mozo, o.id, cuerpo, randomUUID())),
    );
    let conflictos = 0;
    for (const r of respuestas) {
      if (r.status === 201) continue;
      esperarError(r, 409, 'CONFLICTO');
      conflictos += 1;
    }
    for (let i = 0; i < conflictos; i++) {
      expect((await enviarComanda(ctx, t().mozo, o.id, cuerpo)).status).toBe(201);
    }
    expect(llamadasAEnviar()).toEqual([
      {
        sucursalId: A().S1,
        envioId: cuerpo.id,
        partes: sinOrden([P.hamburguesa(2), P.cerveza(2), P.gaseosa(1)]),
      },
    ]);
  });
});

describe('criterio 72 · si el puerto lanza, la respuesta es ese error y nada queda guardado ni publicado', () => {
  it('un ErrorAplicacion del puerto se responde tal cual, sin envío, ítems, comandas ni eventos', async () => {
    const o = await abrir();
    ctx.inventario.lanzarAlEnviar(errorDelPuerto());
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(
        ctx,
        t().mozo,
        o.id,
        envio([L.combo(['Cerveza', 'Ensalada'], 2), L.gaseosa(1)]),
      ),
    );
    esperarError(resultado, 409, 'CONFLICTO');
    expect(resultado.body.mensaje).toBe('No alcanza el stock (simulado)');
    expect(ctx.inventario.alEnviarLlamadas()).toHaveLength(1); // se llamó, y lanzó
    expect(await conteoDeOrden(admin, o.id)).toEqual({
      envios: 0,
      items: 0,
      comandas: 0,
      lineas: 0,
      marchas: 0,
    });
    expect(eventos).toEqual([]);
    expect((await ordenDe(o.id)).items).toEqual([]);
  });

  it('otro error del puerto es un 500 y tampoco deja nada', async () => {
    const o = await abrir();
    ctx.inventario.lanzarAlEnviar(new Error('falla del inventario'));
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.gaseosa(1)])),
    );
    expect(resultado.status).toBe(500);
    expect(resultado.text).not.toContain('falla del inventario');
    expect((await conteoDeOrden(admin, o.id)).envios).toBe(0);
    expect(eventos).toEqual([]);
  });

  it('el rechazo revierte también el cambio de estado de la orden: sigue en pre-cuenta, con su pre-cuenta vigente', async () => {
    const o = await abrir();
    await enviarOk(ctx, t().mozo, o.id, [L.gaseosa(1)]);
    exigirEstado(await pedirPrecuenta(ctx, t().mozo, o.id), 201, 'pre-cuenta');
    ctx.inventario.lanzarAlEnviar(errorDelPuerto());
    const { resultado, eventos } = await conEventos(ctx, () =>
      enviarComanda(ctx, t().mozo, o.id, envio([L.lomo(['3/4'])])),
    );
    esperarError(resultado, 409, 'CONFLICTO');
    expect(eventos).toEqual([]);
    const orden = await ordenDe(o.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente).toMatchObject({ numero: 1 });
    expect(orden.items).toHaveLength(1);
  });

  it('el envío fallido no deja huecos: al quitar el error, el mismo envío sale como la comanda número 1', async () => {
    const o = await abrir();
    const cuerpo = envio([L.lomo(['3/4', 'Huevo'], 1)]);
    ctx.inventario.lanzarAlEnviar(errorDelPuerto());
    esperarError(await enviarComanda(ctx, t().mozo, o.id, cuerpo), 409, 'CONFLICTO');
    ctx.inventario.lanzarAlEnviar(null);
    const res = await enviarComanda(ctx, t().mozo, o.id, cuerpo);
    exigirEstado(res, 201, 'reenvío');
    expect(res.body).toMatchObject({ id: cuerpo.id, numero: 1, esAdicion: false });
    expect(await conteoDeOrden(admin, o.id)).toMatchObject({ envios: 1, items: 1 });
  });
});

describe('criterio 72 · disponibles', () => {
  it('GET /salon/stock devuelve lo que responde el puerto, para los productos pedidos de la sucursal activa', async () => {
    ctx.inventario.fijarDisponibles(new Map([[carta().gaseosa, 7]]));
    const res = await llamar(ctx, t().mozo, {
      metodo: 'get',
      ruta: `/salon/stock?productoIds=${carta().gaseosa},${carta().lomo}`,
    });
    exigirEstado(res, 200, 'GET /salon/stock');
    expect(res.body).toEqual({ productos: [{ productoId: carta().gaseosa, disponible: 7 }] });
    const llamada = ctx.inventario.llamadas().find((l) => l.metodo === 'disponibles');
    if (llamada?.metodo !== 'disponibles') throw new Error('No se llamó a disponibles');
    expect(llamada.entrada.sucursalId).toBe(A().S1);
    expect([...llamada.entrada.productoIds].sort()).toEqual([carta().gaseosa, carta().lomo].sort());
    ctx.inventario.fijarDisponibles(new Map());
  });
});

// ===================================================================================================
// La anulación de un ítem
// ===================================================================================================

describe('criterio 39 · anular un ítem llama al puerto una vez, con las partes por la cantidad anulada', () => {
  /** Orden con un combo [Cerveza, Ensalada] × 3 enviado. */
  async function ordenConCombo() {
    const o = await abrir();
    const e = await enviarOk(ctx, t().mozo, o.id, [L.combo(['Cerveza', 'Ensalada'], 3)]);
    ctx.inventario.limpiar();
    return { o, e, itemId: e.items[0]!.id };
  }

  it('anulación total: las partes de las 3 unidades y el destino elegido', async () => {
    const { o, itemId } = await ordenConCombo();
    const id = randomUUID();
    await anularItemOk(ctx, t().supervisor, o.id, itemId, 3, 'MERMA', id);
    expect(ctx.inventario.llamadas().map((l) => l.metodo)).toEqual(['alAnular']);
    expect(llamadasAAnular()).toEqual([
      {
        sucursalId: A().S1,
        anulacionId: id,
        destino: 'MERMA',
        partes: sinOrden([P.hamburguesa(3), P.cerveza(3)]),
      },
    ]);
  });

  it('anulación parcial: solo las partes de la cantidad anulada', async () => {
    const { o, itemId } = await ordenConCombo();
    const id = randomUUID();
    await anularItemOk(ctx, t().supervisor, o.id, itemId, 1, 'VUELVE', id);
    expect(llamadasAAnular()).toEqual([
      {
        sucursalId: A().S1,
        anulacionId: id,
        destino: 'VUELVE',
        partes: sinOrden([P.hamburguesa(1), P.cerveza(1)]),
      },
    ]);
  });

  it('dos anulaciones parciales del mismo ítem son dos llamadas, cada una con su id y su cantidad', async () => {
    const { o, itemId } = await ordenConCombo();
    const [a, b] = [randomUUID(), randomUUID()];
    await anularItemOk(ctx, t().supervisor, o.id, itemId, 1, 'VUELVE', a);
    await anularItemOk(ctx, t().supervisor, o.id, itemId, 2, 'MERMA', b);
    expect(llamadasAAnular()).toEqual([
      {
        sucursalId: A().S1,
        anulacionId: a,
        destino: 'VUELVE',
        partes: sinOrden([P.hamburguesa(1), P.cerveza(1)]),
      },
      {
        sucursalId: A().S1,
        anulacionId: b,
        destino: 'MERMA',
        partes: sinOrden([P.hamburguesa(2), P.cerveza(2)]),
      },
    ]);
  });

  it('un ítem sin control de stock llama una vez con la lista de partes vacía', async () => {
    const o = await abrir();
    const e = await enviarOk(ctx, t().mozo, o.id, [L.lomo(['3/4'], 2)]);
    ctx.inventario.limpiar();
    const id = randomUUID();
    await anularItemOk(ctx, t().supervisor, o.id, e.items[0]!.id, 2, 'VUELVE', id);
    expect(llamadasAAnular()).toEqual([
      { sucursalId: A().S1, anulacionId: id, destino: 'VUELVE', partes: [] },
    ]);
  });

  it('nunca en una réplica: ni con la misma clave, ni con el mismo id de anulación y otra clave', async () => {
    const { o, itemId } = await ordenConCombo();
    const cuerpo = { id: randomUUID(), cantidad: 1, motivo: 'Se cayó', destinoStock: 'MERMA' };
    const k = randomUUID();
    exigirEstado(await anularItem(t().supervisor, o.id, itemId, cuerpo, k), 201, 'anular');
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect((await anularItem(t().supervisor, o.id, itemId, cuerpo, k)).status).toBe(201);
    expect((await anularItem(t().supervisor, o.id, itemId, cuerpo)).status).toBe(201);
    expect((await anularItem(t().supervisor, o.id, itemId, cuerpo)).status).toBe(201);
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect((await ordenDe(o.id)).items[0]).toMatchObject({
      cantidadAnulada: 1,
      cantidadVigente: 2,
    });
  });

  it('nunca en una anulación rechazada (cantidad de más, ítem ya anulado, orden no abierta, datos)', async () => {
    const { o, itemId } = await ordenConCombo();
    const base = { motivo: 'Prueba', destinoStock: 'VUELVE' };
    esperarError(
      await anularItem(t().supervisor, o.id, itemId, { ...base, id: randomUUID(), cantidad: 4 }),
      422,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await anularItem(t().supervisor, o.id, itemId, { ...base, id: randomUUID(), cantidad: 0 }),
      400,
      'DATOS_INVALIDOS',
    );
    await anularItemOk(ctx, t().supervisor, o.id, itemId, 3);
    ctx.inventario.limpiar();
    esperarError(
      await anularItem(t().supervisor, o.id, itemId, { ...base, id: randomUUID(), cantidad: 1 }),
      409,
      'ITEM_NO_ANULABLE',
    );
    expect(ctx.inventario.llamadas()).toEqual([]);

    const otra = await ordenConCombo();
    await anularOrdenOk(ctx, t().supervisor, otra.o.id);
    ctx.inventario.limpiar();
    esperarError(
      await anularItem(t().supervisor, otra.o.id, otra.itemId, {
        ...base,
        id: randomUUID(),
        cantidad: 1,
      }),
      409,
      'ORDEN_NO_ABIERTA',
    );
    expect(ctx.inventario.llamadas()).toEqual([]);
  });

  it('si el puerto lanza, la respuesta es ese error y no queda anulación, comanda, auditoría ni evento', async () => {
    const { o, itemId } = await ordenConCombo();
    const comandasAntes = (await comandasDeOrden(admin, o.id)).length;
    const auditoriasAntes = await auditoriasDe('anular_item');
    ctx.inventario.lanzarAlAnular(errorDelPuerto());
    const id = randomUUID();
    const { resultado, eventos } = await conEventos(ctx, () =>
      anularItem(t().supervisor, o.id, itemId, {
        id,
        cantidad: 2,
        motivo: 'Prueba',
        destinoStock: 'MERMA',
      }),
    );
    esperarError(resultado, 409, 'CONFLICTO');
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect(eventos).toEqual([]);
    expect((await ordenDe(o.id)).items[0]).toMatchObject({
      cantidadAnulada: 0,
      cantidadVigente: 3,
      estado: 'ENVIADO',
    });
    expect((await comandasDeOrden(admin, o.id)).length).toBe(comandasAntes);
    expect(await comandasDeOrden(admin, o.id, 'ANULACION')).toEqual([]);
    expect(await auditoriasDe('anular_item')).toBe(auditoriasAntes);

    // Al quitar el error, la misma anulación (mismo id) sale como si fuera la primera.
    ctx.inventario.lanzarAlAnular(null);
    ctx.inventario.limpiar();
    const ok = await anularItem(t().supervisor, o.id, itemId, {
      id,
      cantidad: 2,
      motivo: 'Prueba',
      destinoStock: 'MERMA',
    });
    exigirEstado(ok, 201, 'anular sin el error');
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
  });

  it('el rechazo del puerto no saca a la orden de la pre-cuenta', async () => {
    const { o, itemId } = await ordenConCombo();
    exigirEstado(await pedirPrecuenta(ctx, t().mozo, o.id), 201, 'pre-cuenta');
    ctx.inventario.lanzarAlAnular(errorDelPuerto());
    esperarError(
      await anularItem(t().supervisor, o.id, itemId, {
        id: randomUUID(),
        cantidad: 1,
        motivo: 'Prueba',
        destinoStock: 'VUELVE',
      }),
      409,
      'CONFLICTO',
    );
    const orden = await ordenDe(o.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente).toMatchObject({ numero: 1 });
  });
});

// ===================================================================================================
// La anulación de la orden
// ===================================================================================================

describe('criterio 72 · anular la orden llama al puerto una vez, con todas las partes vigentes', () => {
  /** Orden con un combo × 2, un menú, una gaseosa × 4 y un lomo; al combo se le anula 1 antes. */
  async function ordenVariada(): Promise<{ o: OrdenAbierta; e: EnvioRespuestaDePrueba }> {
    const o = await abrir();
    const lineas: LineaCuerpo[] = [
      L.combo(['Cerveza', 'Ensalada'], 2),
      L.menu(['Sopa', 'Ají de gallina'], 1),
      L.gaseosa(4),
      L.lomo(['3/4', 'Huevo'], 1),
    ];
    const e = await enviarOk(ctx, t().mozo, o.id, lineas);
    return { o, e };
  }

  it('suma las partes de la cantidad vigente de cada ítem, con el destino elegido', async () => {
    const { o, e } = await ordenVariada();
    await anularItemOk(ctx, t().supervisor, o.id, e.items[0]!.id, 1, 'VUELVE');
    ctx.inventario.limpiar();
    exigirEstado(
      await anularOrden(t().supervisor, o.id, { motivo: 'Se fueron', destinoStock: 'MERMA' }),
      200,
      'anular la orden',
    );
    expect(ctx.inventario.llamadas().map((l) => l.metodo)).toEqual(['alAnular']);
    const [llamada] = llamadasAAnular();
    expect(llamada).toMatchObject({ sucursalId: A().S1, destino: 'MERMA' });
    expect(llamada!.partes).toEqual(
      sinOrden([
        P.hamburguesa(1),
        P.cerveza(1),
        P.menu(1),
        P.refresco(1),
        P.sopa(1),
        P.aji(1),
        P.gaseosa(4),
        P.huevo(1),
      ]),
    );
    // Una sola llamada con el id de la anulación (al anular una orden, el id de la orden).
    expect(llamada!.anulacionId).toBe(o.id);
  });

  it('nunca en una réplica de la misma clave ni en una segunda anulación de la misma orden', async () => {
    const { o } = await ordenVariada();
    ctx.inventario.limpiar();
    const cuerpo = { motivo: 'Se fueron', destinoStock: 'VUELVE' };
    const k = randomUUID();
    exigirEstado(await anularOrden(t().supervisor, o.id, cuerpo, k), 200, 'anular la orden');
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect((await anularOrden(t().supervisor, o.id, cuerpo, k)).status).toBe(200);
    esperarError(await anularOrden(t().supervisor, o.id, cuerpo), 409, 'ORDEN_NO_ABIERTA');
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
  });

  it('si el puerto lanza, la orden sigue abierta con todos sus ítems y no queda auditoría, comanda ni evento', async () => {
    const { o, e } = await ordenVariada();
    const comandasAntes = (await comandasDeOrden(admin, o.id)).length;
    const auditoriasAntes = await auditoriasDe('anular_orden');
    ctx.inventario.lanzarAlAnular(errorDelPuerto());
    const { resultado, eventos } = await conEventos(ctx, () =>
      anularOrden(t().supervisor, o.id, { motivo: 'Se fueron', destinoStock: 'VUELVE' }),
    );
    esperarError(resultado, 409, 'CONFLICTO');
    expect(ctx.inventario.alAnularLlamadas()).toHaveLength(1);
    expect(eventos).toEqual([]);
    const orden = await ordenDe(o.id);
    expect(orden.estado).toBe('ABIERTA');
    expect(orden.items.map((i) => i.estado)).toEqual(e.items.map(() => 'ENVIADO'));
    expect(orden.items.every((i) => i.cantidadAnulada === 0)).toBe(true);
    expect((await comandasDeOrden(admin, o.id)).length).toBe(comandasAntes);
    expect(await auditoriasDe('anular_orden')).toBe(auditoriasAntes);

    ctx.inventario.lanzarAlAnular(null);
    exigirEstado(
      await anularOrden(t().supervisor, o.id, { motivo: 'Se fueron', destinoStock: 'VUELVE' }),
      200,
      'anular la orden sin el error',
    );
    expect((await ordenDe(o.id)).estado).toBe('ANULADA');
  });

  it('liberar una mesa sin consumo no llama al puerto', async () => {
    const o = await abrir();
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/liberacion`,
      cabeceras: clave(),
    });
    exigirEstado(res, 200, 'liberar la mesa');
    await asentar();
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect((await ordenDe(o.id)).estado).toBe('ANULADA');
  });
});
