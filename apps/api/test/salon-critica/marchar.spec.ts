// spec: 004-salon-cocina (pruebas protegidas)
//
// P2 · Marchar el segundo tiempo · Criterios 32 y 33 (HU-13, RF-28). La API real con `RelojManual`,
// `PublicadorEnMemoria` e `InventarioDePrueba`, la carta de ejemplo de `spec.md` creada por las rutas de 003 y
// las órdenes abiertas y enviadas por las rutas de 3a.
//
// Cubre: marchar todos los ítems de segundo tiempo o solo algunos; los ítems que no se pueden marchar (422); no
// haber nada que marchar (409 NADA_QUE_MARCHAR); la réplica con la misma clave y con el mismo id, también
// concurrente; el segundo tiempo de una adición, que necesita otra marcha; el primer tiempo, que nunca se
// marcha; la orden que ya no está abierta; la forma de la entrada; y los eventos.
import { marchaRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  anularItemOk,
  anularOrdenOk,
  arrancarP2,
  camposDe,
  clave,
  comandaDe,
  comandasDeOrden,
  conEventos,
  conteoDeOrden,
  cuerpoSinIds,
  enviarOk,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  lineasDeComanda,
  llamar,
  marchar,
  prepararEscenarioP2,
  unirMesasOk,
  verOrden,
  type AppP2,
  type ComandaDePrueba,
  type EnvioRespuestaDePrueba,
  type EscenarioP2,
  type ItemDePrueba,
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

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
  L = lineasDe(esc.carta);
});

beforeEach(() => {
  ctx.reloj.fijar(INICIO_POR_DEFECTO);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const abrir = (token: string = t().mozo): Promise<OrdenAbierta> =>
  abrirOrden(ctx, esc.salon, token);

const enviarComoMozo = (ordenId: string, lineas: LineaCuerpo[]) =>
  enviarOk(ctx, t().mozo, ordenId, lineas);

const ordenDe = async (ordenId: string) => {
  const res = await verOrden(ctx, t().mozo, ordenId);
  exigirEstado(res, 200, 'GET /ordenes/:id');
  return res.body as { estado: string; items: ItemDePrueba[] };
};

const itemsDe = async (ordenId: string): Promise<ItemDePrueba[]> => (await ordenDe(ordenId)).items;

/** El ítem de la respuesta del envío que está en esa posición. */
const item = (e: EnvioRespuestaDePrueba, i: number): ItemDePrueba => e.items[i]!;

/** Marcha con el Mozo y exige 201; devuelve el cuerpo. */
async function marcharOk(ordenId: string, cuerpo: unknown) {
  const res = await marchar(ctx, t().mozo, ordenId, cuerpo);
  exigirEstado(res, 201, 'marchar');
  return marchaRespuestaSchema.parse(res.body) as { id: string; comandas: ComandaDePrueba[] };
}

/** Cuántas filas de comanda de tipo MARCHAR tiene la orden. */
const marchasDe = async (ordenId: string) =>
  (await comandasDeOrden(admin, ordenId, 'MARCHAR')).length;

// ===================================================================================================
// Criterio 32 · marchar
// ===================================================================================================

describe('criterio 32 · marchar todos los ítems de segundo tiempo', () => {
  it('crea una comanda MARCHAR por estación con las partes de esos ítems, marca los ítems y libera las líneas originales', async () => {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4', 'Huevo'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 2, { tiempo: 2 }),
      L.gaseosa(1),
      L.lomo(['Jugoso'], 1),
    ]);
    const id = randomUUID();
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, o.id, { id }),
    );
    exigirEstado(resultado, 201, 'marchar');
    const cuerpo = marchaRespuestaSchema.parse(resultado.body);
    expect(cuerpo.id).toBe(id);
    expect(cuerpo.comandas.map((c) => [c.estacionNombre, c.tipo, c.destino]).sort()).toEqual([
      ['Barra', 'MARCHAR', 'KDS'],
      ['Cocina', 'MARCHAR', 'KDS'],
    ]);

    // Las líneas de cada comanda MARCHAR son las partes de los ítems marchados en esa estación.
    const forma = (ls: Awaited<ReturnType<typeof lineasDeComanda>>) =>
      ls.map((l) => [l.rol, l.nombre, l.cantidad, l.contexto, l.modificadores]);
    const cocina = await lineasDeComanda(admin, comandaDe(cuerpo.comandas, 'Cocina').id);
    expect(forma(cocina)).toEqual([
      ['PRODUCTO', 'Lomo saltado', 1, null, ['3/4', 'Huevo']],
      ['COMPONENTE', 'Hamburguesa clásica', 2, 'Combo hamburguesa', ['Ensalada']],
    ]);
    const barra = await lineasDeComanda(admin, comandaDe(cuerpo.comandas, 'Barra').id);
    expect(forma(barra)).toEqual([['LIGADO', 'Cerveza Pilsen', 2, 'Combo hamburguesa', []]]);

    // Los ítems de segundo tiempo quedan marchados (con la hora de la API); los demás, no.
    const items = await itemsDe(o.id);
    expect(items.map((i) => i.marchadoEn !== null)).toEqual([true, true, false, false]);
    for (const i of items.filter((x) => x.marchadoEn !== null)) {
      expect(Date.parse(i.marchadoEn!)).toBe(Date.parse(INICIO_POR_DEFECTO));
    }
    // Las líneas originales del envío ya no esperan.
    for (const c of e.comandas) {
      for (const l of await lineasDeComanda(admin, c.id)) {
        expect(l.esperar, `${l.nombre} (tiempo ${l.tiempo})`).toBe(false);
      }
    }
    // Marchar no toca el inventario, crea una marcha y publica los eventos.
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect((await conteoDeOrden(admin, o.id)).marchas).toBe(1);
    expect(eventos.map((ev) => ev.nombre).sort()).toEqual([
      'cocina.comanda',
      'cocina.comanda',
      'orden.cambio',
    ]);
    for (const ev of eventos) {
      expect(ev.empresaId).toBe(A().empresaId);
      expect(ev.sala).toEqual({ tipo: 'sucursal', sucursalId: A().S1 });
    }
    expect(
      eventos
        .filter((ev) => ev.nombre === 'cocina.comanda')
        .map((ev) => ev.datos)
        .sort((x, y) => String(x.comandaId).localeCompare(String(y.comandaId))),
    ).toEqual(
      cuerpo.comandas
        .map((c) => ({ comandaId: c.id, estacionId: c.estacionId, tipo: 'MARCHAR' }))
        .sort((x, y) => x.comandaId.localeCompare(y.comandaId)),
    );
    expect(eventos.find((ev) => ev.nombre === 'orden.cambio')!.datos).toEqual({ ordenId: o.id });
  });

  it('antes de marchar, las líneas de los ítems de segundo tiempo esperan; las de primer tiempo, no', async () => {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.lomo(['Jugoso'], 1, { tiempo: 1 }),
    ]);
    const lineas = await lineasDeComanda(admin, comandaDe(e.comandas, 'Cocina').id);
    expect(lineas.map((l) => [l.modificadores, l.esperar])).toEqual([
      [['3/4'], true],
      [['Jugoso'], false],
    ]);
  });
});

describe('criterio 32 · marchar solo algunos ítems', () => {
  it('marcha solo los de itemIds; los demás siguen por marchar y se marchan después', async () => {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
      L.menu(['Sopa', 'Ají de gallina'], 1, { tiempo: 2 }),
    ]);
    const [lomo, combo, menu] = [item(e, 0), item(e, 1), item(e, 2)];

    const primera = await marcharOk(o.id, { id: randomUUID(), itemIds: [lomo.id] });
    expect(primera.comandas.map((c) => c.estacionNombre)).toEqual(['Cocina']);
    let items = await itemsDe(o.id);
    expect(items.map((i) => i.marchadoEn !== null)).toEqual([true, false, false]);

    const segunda = await marcharOk(o.id, {
      id: randomUUID(),
      itemIds: [combo.id.toUpperCase()],
    });
    expect(segunda.comandas.map((c) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    items = await itemsDe(o.id);
    expect(items.map((i) => i.marchadoEn !== null)).toEqual([true, true, false]);

    const resto = await marcharOk(o.id, { id: randomUUID() });
    expect(resto.comandas.map((c) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    const lineasMenu = (
      await Promise.all(resto.comandas.map((c) => lineasDeComanda(admin, c.id)))
    ).flat();
    expect(lineasMenu.map((l) => l.itemId).every((id) => id === menu.id)).toBe(true);
    expect(lineasMenu.map((l) => l.nombre).sort()).toEqual([
      'Ají de gallina',
      'Refresco del día',
      'Sopa de casa',
    ]);

    // Cada ítem se marchó una sola vez: tres marchas, cinco comandas MARCHAR.
    expect((await conteoDeOrden(admin, o.id)).marchas).toBe(3);
    expect(await marchasDe(o.id)).toBe(5);
    const otra = await marchar(ctx, t().mozo, o.id, { id: randomUUID() });
    esperarError(otra, 409, 'NADA_QUE_MARCHAR');
  });

  it('un ítem anulado del todo no se marcha', async () => {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    await anularItemOk(ctx, t().supervisor, o.id, item(e, 0).id, 1);
    const marcha = await marcharOk(o.id, { id: randomUUID() });
    const lineas = (
      await Promise.all(marcha.comandas.map((c) => lineasDeComanda(admin, c.id)))
    ).flat();
    expect(lineas.every((l) => l.itemId === item(e, 1).id)).toBe(true);
    const items = await itemsDe(o.id);
    expect(items[0]).toMatchObject({ estado: 'ANULADO', marchadoEn: null });
    expect(items[1]!.marchadoEn).not.toBeNull();
    // El ítem anulado no se puede marchar ni nombrándolo.
    const nombrado = await marchar(ctx, t().mozo, o.id, {
      id: randomUUID(),
      itemIds: [item(e, 0).id],
    });
    esperarError(nombrado, 422, 'DATOS_INVALIDOS');
  });
});

describe('criterio 32 · itemIds que no se pueden marchar', () => {
  /** Orden con un ítem de segundo tiempo (0), uno de primer tiempo (1) y uno ya marchado (2). */
  async function ordenConTres() {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.lomo(['Jugoso'], 1, { tiempo: 1 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    await marcharOk(o.id, { id: randomUUID(), itemIds: [item(e, 2).id] });
    return { o, e };
  }

  it.each([
    ['de primer tiempo', (e: EnvioRespuestaDePrueba) => item(e, 1).id],
    ['que ya se marchó', (e: EnvioRespuestaDePrueba) => item(e, 2).id],
    ['que no existe', () => randomUUID()],
  ])(
    'un ítem %s responde 422 DATOS_INVALIDOS con campos, aunque haya otro válido, y no marcha nada',
    async (_n, malo) => {
      const { o, e } = await ordenConTres();
      const antes = await conteoDeOrden(admin, o.id);
      const eventos = await conEventos(ctx, () =>
        marchar(ctx, t().mozo, o.id, { id: randomUUID(), itemIds: [item(e, 0).id, malo(e)] }),
      );
      esperarError(eventos.resultado, 422, 'DATOS_INVALIDOS');
      expect(camposDe(eventos.resultado).length).toBeGreaterThan(0);
      expect(eventos.eventos).toEqual([]);
      expect(await conteoDeOrden(admin, o.id)).toEqual(antes);
      expect((await itemsDe(o.id))[0]!.marchadoEn).toBeNull();
    },
  );

  it('un ítem de otra orden de A o de B se rechaza igual que uno inexistente', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const otra = await abrir();
    const deOtra = await enviarComoMozo(otra.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const ordenB = await abrirOrden(ctx, esc.salonB, t().mozoB);
    const deB = await enviarOk(ctx, t().mozoB, ordenB.id, [
      lineasDe(esc.cartaB).lomo(['3/4'], 1, { tiempo: 2 }),
    ]);
    const inexistente = randomUUID();
    const pedir = (itemId: string) =>
      marchar(ctx, t().mozo, o.id, { id: randomUUID(), itemIds: [itemId] });
    const resOtra = await pedir(item(deOtra, 0).id);
    const resB = await pedir(item(deB, 0).id);
    const resNada = await pedir(inexistente);
    esperarError(resNada, 422, 'DATOS_INVALIDOS');
    esperarError(resOtra, 422, 'DATOS_INVALIDOS');
    esperarError(resB, 422, 'DATOS_INVALIDOS');
    expect(cuerpoSinIds(resOtra, [item(deOtra, 0).id])).toEqual(
      cuerpoSinIds(resNada, [inexistente]),
    );
    expect(cuerpoSinIds(resB, [item(deB, 0).id])).toEqual(cuerpoSinIds(resNada, [inexistente]));
    // Nada se marchó, ni en A ni en B.
    expect((await conteoDeOrden(admin, otra.id)).marchas).toBe(0);
    expect((await itemsDe(otra.id))[0]!.marchadoEn).toBeNull();
    expect(await marchasDe(ordenB.id)).toBe(0);
  });
});

describe('criterio 32 · nada que marchar', () => {
  it('una orden sin ítems responde 409 NADA_QUE_MARCHAR y no crea nada', async () => {
    const o = await abrir();
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, o.id, { id: randomUUID() }),
    );
    esperarError(resultado, 409, 'NADA_QUE_MARCHAR');
    expect(eventos).toEqual([]);
    expect(await conteoDeOrden(admin, o.id)).toMatchObject({ marchas: 0, comandas: 0 });
  });

  it('una orden con solo ítems de primer tiempo responde 409 NADA_QUE_MARCHAR', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 1 }), L.gaseosa(2)]);
    const antes = await conteoDeOrden(admin, o.id);
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, o.id, { id: randomUUID() }),
    );
    esperarError(resultado, 409, 'NADA_QUE_MARCHAR');
    expect(eventos).toEqual([]);
    expect(await conteoDeOrden(admin, o.id)).toEqual(antes);
  });

  it('una orden cuyos ítems de segundo tiempo ya se marcharon responde 409 NADA_QUE_MARCHAR', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    await marcharOk(o.id, { id: randomUUID() });
    const res = await marchar(ctx, t().mozo, o.id, { id: randomUUID() });
    esperarError(res, 409, 'NADA_QUE_MARCHAR');
    expect((await conteoDeOrden(admin, o.id)).marchas).toBe(1);
  });
});

// ===================================================================================================
// Réplicas y concurrencia
// ===================================================================================================

describe('criterio 32 · réplicas', () => {
  async function ordenMarchada() {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    const cuerpo = { id: randomUUID() };
    const k = randomUUID();
    const res = await marchar(ctx, t().mozo, o.id, cuerpo, k);
    exigirEstado(res, 201, 'marchar');
    return { o, e, cuerpo, k, res, filas: await conteoDeOrden(admin, o.id) };
  }

  it('la misma clave con el mismo cuerpo devuelve la misma marcha sin otra comanda ni eventos', async () => {
    const m = await ordenMarchada();
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, m.o.id, m.cuerpo, m.k),
    );
    expect(resultado.status).toBe(201);
    expect(resultado.body).toEqual(m.res.body);
    expect(eventos).toEqual([]);
    expect(await conteoDeOrden(admin, m.o.id)).toEqual(m.filas);
  });

  it('el mismo id con otra clave devuelve la misma marcha, aunque ya no quede nada por marchar', async () => {
    const m = await ordenMarchada();
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, m.o.id, m.cuerpo),
    );
    expect(resultado.status, resultado.text).toBe(201);
    expect(resultado.body).toEqual(m.res.body);
    expect(eventos).toEqual([]);
    expect(await conteoDeOrden(admin, m.o.id)).toEqual(m.filas);
  });

  it('el mismo id desde otra sesión de la empresa devuelve la misma marcha', async () => {
    const m = await ordenMarchada();
    const res = await marchar(ctx, t().mozo2, m.o.id, m.cuerpo);
    expect(res.status, res.text).toBe(201);
    expect(res.body).toEqual(m.res.body);
    expect(await conteoDeOrden(admin, m.o.id)).toEqual(m.filas);
  });

  it('el mismo id con otros ítems responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA y no crea nada', async () => {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    const id = randomUUID();
    exigirEstado(
      await marchar(ctx, t().mozo, o.id, { id, itemIds: [item(e, 0).id] }),
      201,
      'primera marcha',
    );
    const filas = await conteoDeOrden(admin, o.id);
    for (const cuerpo of [{ id, itemIds: [item(e, 1).id] }, { id }]) {
      esperarError(
        await marchar(ctx, t().mozo, o.id, cuerpo),
        422,
        'CLAVE_IDEMPOTENCIA_REUTILIZADA',
      );
    }
    expect(await conteoDeOrden(admin, o.id)).toEqual(filas);
    expect((await itemsDe(o.id))[1]!.marchadoEn).toBeNull();
  });

  it('el mismo id en otra orden responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const m = await ordenMarchada();
    const otra = await abrir();
    await enviarComoMozo(otra.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const res = await marchar(ctx, t().mozo, otra.id, m.cuerpo);
    esperarError(res, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect((await conteoDeOrden(admin, otra.id)).marchas).toBe(0);
  });

  it('la misma clave con otro cuerpo responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const m = await ordenMarchada();
    const res = await marchar(ctx, t().mozo, m.o.id, { id: randomUUID() }, m.k);
    esperarError(res, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect(await conteoDeOrden(admin, m.o.id)).toEqual(m.filas);
  });
});

describe('criterio 32 · marchar una sola vez', () => {
  it('diez réplicas simultáneas del mismo id dejan una marcha y una comanda MARCHAR por estación', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    const cuerpo = { id: randomUUID() };
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_v, i) =>
        marchar(ctx, i % 2 === 0 ? t().mozo : t().mozo2, o.id, cuerpo, randomUUID()),
      ),
    );
    const cuerpos: unknown[] = [];
    let conflictos = 0;
    for (const r of respuestas) {
      if (r.status === 201) {
        cuerpos.push(r.body);
      } else {
        esperarError(r, 409, 'CONFLICTO');
        conflictos += 1;
      }
    }
    expect(cuerpos.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < conflictos; i++) {
      const repetida = await marchar(ctx, t().mozo, o.id, cuerpo);
      expect(repetida.status, repetida.text).toBe(201);
      cuerpos.push(repetida.body);
    }
    for (const c of cuerpos) expect(c).toEqual(cuerpos[0]);
    expect((await conteoDeOrden(admin, o.id)).marchas).toBe(1);
    expect(await marchasDe(o.id)).toBe(2);
    const items = await itemsDe(o.id);
    expect(items.every((i) => i.marchadoEn !== null)).toBe(true);
  });

  it('dos marchas con ids distintos a la vez marchan cada ítem una sola vez', async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const o = await abrir();
      await enviarComoMozo(o.id, [
        L.lomo(['3/4'], 1, { tiempo: 2 }),
        L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
      ]);
      const [a, b] = await Promise.all([
        marchar(ctx, t().mozo, o.id, { id: randomUUID() }),
        marchar(ctx, t().mozo2, o.id, { id: randomUUID() }),
      ]);
      const exitos = [a, b].filter((r) => r.status === 201);
      expect(exitos, `ronda ${ronda}: ${a.status} y ${b.status}`).toHaveLength(1);
      const otra = [a, b].find((r) => r.status !== 201)!;
      // La que llegó segundo no encontró nada (o un bloqueo que, repetido, tampoco encuentra nada).
      if (otra.body.codigo === 'CONFLICTO') {
        esperarError(
          await marchar(ctx, t().mozo, o.id, { id: randomUUID() }),
          409,
          'NADA_QUE_MARCHAR',
        );
      } else {
        esperarError(otra, 409, 'NADA_QUE_MARCHAR');
      }
      expect((await conteoDeOrden(admin, o.id)).marchas).toBe(1);
      expect(await marchasDe(o.id)).toBe(2);
    }
  });
});

// ===================================================================================================
// Criterio 33 · segundo tiempo de una adición
// ===================================================================================================

describe('criterio 33 · segundo tiempo de una adición', () => {
  it('un ítem de tiempo 2 enviado después de una marcha sale con ESPERAR y necesita otra marcha', async () => {
    const o = await abrir();
    const primero = await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const marcha1 = await marcharOk(o.id, { id: randomUUID() });
    expect(marcha1.comandas.map((c) => c.estacionNombre)).toEqual(['Cocina']);

    const adicion = await enviarComoMozo(o.id, [L.lomo(['Jugoso'], 2, { tiempo: 2 })]);
    expect(adicion.esAdicion).toBe(true);
    // La parte de la adición espera aunque ya hubo una marcha en la orden.
    const lineas = await lineasDeComanda(admin, comandaDe(adicion.comandas, 'Cocina').id);
    expect(lineas.map((l) => [l.nombre, l.cantidad, l.esperar])).toEqual([
      ['Lomo saltado', 2, true],
    ]);
    let items = await itemsDe(o.id);
    expect(items.map((i) => i.marchadoEn !== null)).toEqual([true, false]);

    const marcha2 = await marcharOk(o.id, { id: randomUUID() });
    expect(marcha2.comandas.map((c) => c.estacionNombre)).toEqual(['Cocina']);
    const deMarcha = await lineasDeComanda(admin, marcha2.comandas[0]!.id);
    expect(deMarcha.map((l) => [l.itemId, l.nombre, l.cantidad, l.modificadores])).toEqual([
      [item(adicion, 0).id, 'Lomo saltado', 2, ['Jugoso']],
    ]);
    items = await itemsDe(o.id);
    expect(items.every((i) => i.marchadoEn !== null)).toBe(true);
    // La parte de la adición ya no espera; la del primer envío sigue como quedó.
    expect(
      (await lineasDeComanda(admin, comandaDe(adicion.comandas, 'Cocina').id))[0]!.esperar,
    ).toBe(false);
    expect(
      (await lineasDeComanda(admin, comandaDe(primero.comandas, 'Cocina').id))[0]!.esperar,
    ).toBe(false);
    expect(await marchasDe(o.id)).toBe(2);
    esperarError(await marchar(ctx, t().mozo, o.id, { id: randomUUID() }), 409, 'NADA_QUE_MARCHAR');
  });

  it('un ítem de tiempo 1 nunca se marcha, tampoco nombrándolo', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    await marcharOk(o.id, { id: randomUUID() });
    const adicion = await enviarComoMozo(o.id, [L.lomo(['Jugoso'], 1, { tiempo: 1 })]);
    esperarError(await marchar(ctx, t().mozo, o.id, { id: randomUUID() }), 409, 'NADA_QUE_MARCHAR');
    const nombrado = await marchar(ctx, t().mozo, o.id, {
      id: randomUUID(),
      itemIds: [item(adicion, 0).id],
    });
    esperarError(nombrado, 422, 'DATOS_INVALIDOS');
    expect((await itemsDe(o.id))[1]!.marchadoEn).toBeNull();
    expect(await marchasDe(o.id)).toBe(1);
  });

  it('con una orden unida se marchan todos los ítems de segundo tiempo de la principal, incluidos los que vinieron de la absorbida', async () => {
    const principal = await abrir();
    const absorbida = await abrir();
    await enviarComoMozo(principal.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    const deLaOtra = await enviarComoMozo(absorbida.id, [
      L.combo(['Cerveza', 'Ensalada'], 1, { tiempo: 2 }),
    ]);
    await unirMesasOk(ctx, t().mozo, principal.id, [absorbida.mesaId]);
    const marcha = await marcharOk(principal.id, { id: randomUUID() });
    expect(marcha.comandas.map((c) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    const items = await itemsDe(principal.id);
    expect(items.map((i) => i.marchadoEn !== null)).toEqual([true, true]);
    expect(items.map((i) => i.id)).toContain(item(deLaOtra, 0).id);
  });
});

// ===================================================================================================
// Orden que no está abierta, ids de otra sucursal o empresa y forma de la entrada
// ===================================================================================================

describe('criterio 32 · la orden', () => {
  it('una orden ANULADA responde 409 ORDEN_NO_ABIERTA aunque tenga ítems por marchar', async () => {
    const o = await abrir();
    await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    await anularOrdenOk(ctx, t().supervisor, o.id);
    const antes = await conteoDeOrden(admin, o.id);
    const { resultado, eventos } = await conEventos(ctx, () =>
      marchar(ctx, t().mozo, o.id, { id: randomUUID() }),
    );
    esperarError(resultado, 409, 'ORDEN_NO_ABIERTA');
    expect(eventos).toEqual([]);
    expect(await conteoDeOrden(admin, o.id)).toEqual(antes);
  });

  it('una orden de otra sucursal de A, de B o inexistente responde 404 con el mismo cuerpo', async () => {
    const deS2 = await abrirOrden(ctx, esc.salonS2, t().mozoS2);
    const deB = await abrirOrden(ctx, esc.salonB, t().mozoB);
    const inexistente = randomUUID();
    const pedir = (id: string) => marchar(ctx, t().mozo, id, { id: randomUUID() });
    const resNada = await pedir(inexistente);
    const resS2 = await pedir(deS2.id);
    const resB = await pedir(deB.id);
    esperarError(resNada, 404, 'NO_ENCONTRADO');
    esperarError(resS2, 404, 'NO_ENCONTRADO');
    esperarError(resB, 404, 'NO_ENCONTRADO');
    expect(cuerpoSinIds(resS2, [deS2.id])).toEqual(cuerpoSinIds(resNada, [inexistente]));
    expect(cuerpoSinIds(resB, [deB.id])).toEqual(cuerpoSinIds(resNada, [inexistente]));
  });
});

describe('criterio 32 · forma de la entrada', () => {
  async function ordenConSegundoTiempo() {
    const o = await abrir();
    const e = await enviarComoMozo(o.id, [L.lomo(['3/4'], 1, { tiempo: 2 })]);
    return { o, e };
  }

  it('sin Idempotency-Key responde 400 DATOS_INVALIDOS con el campo', async () => {
    const { o } = await ordenConSegundoTiempo();
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/marchas`,
      cuerpo: { id: randomUUID() },
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(camposDe(res)).toContain('Idempotency-Key');
    expect(await marchasDe(o.id)).toBe(0);
  });

  it.each([
    ['sin id', () => ({})],
    ['con un id que no es UUID', () => ({ id: 'x' })],
    ['con itemIds vacío', () => ({ id: randomUUID(), itemIds: [] })],
    ['con un itemId que no es UUID', () => ({ id: randomUUID(), itemIds: ['x'] })],
    [
      'con un itemId repetido',
      () => {
        const repetido = randomUUID();
        return { id: randomUUID(), itemIds: [repetido, repetido] };
      },
    ],
    ['con un campo desconocido', () => ({ id: randomUUID(), todos: true })],
    ['con empresaId', () => ({ id: randomUUID(), empresaId: randomUUID() })],
  ])('un cuerpo %s responde 400 DATOS_INVALIDOS y no marcha nada', async (_n, cuerpo) => {
    const { o } = await ordenConSegundoTiempo();
    const res = await llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${o.id}/marchas`,
      cuerpo: cuerpo(),
      cabeceras: clave(),
    });
    esperarError(res, 400, 'DATOS_INVALIDOS');
    expect(await marchasDe(o.id)).toBe(0);
    expect((await itemsDe(o.id))[0]!.marchadoEn).toBeNull();
  });
});
