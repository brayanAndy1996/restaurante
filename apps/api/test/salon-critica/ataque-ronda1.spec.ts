// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 1, a la entrega 3a. Cada falla del ataque se convierte aquí en pruebas. La API real
// con `RelojManual`, `PublicadorEnMemoria` e `InventarioObservador`, la carta de ejemplo de `spec.md` (más
// productos propios de cada prueba) creada por las rutas de 003 y las órdenes abiertas, enviadas, marchadas,
// anuladas y unidas por las rutas de 3a. Solo usan contratos públicos; para leer filas, un cliente
// administrador de solo lectura.
//
// F1 (crítica, criterios 15, 22, 32, 35, 38, 42 y 56 a 59). Cantidades que desbordan `smallint`: un combo con un
// componente simple de Cocina × 33 (y × 99, el máximo del contrato, `CANTIDAD_MAXIMA_COMPONENTE`) enviado con
// `cantidad: 999` produce partes de 32967 (y 98901) unidades. El envío es válido según el contrato (201) y
// después deben responder bien el KDS, "Todo listo", el estado de una línea, marchar, anular el ítem y anular la
// orden, con las cantidades exactas en las líneas del KDS (también en las comandas `MARCHAR` y `ANULACION`) y
// en el aviso `cocina.listo`.
//
// F2 (crítica, criterios 21, 47 y 50). Unir mesas ocupadas cuyas cuentas juntas pasan de `99999999.99`: 422
// `MONTO_FUERA_DE_RANGO` sin cambiar nada (las dos órdenes siguen abiertas con sus ítems y mesas, sin auditoría
// `unir_ordenes` y sin eventos) y la pre-cuenta de la principal sigue respondiendo 201; justo en el tope se
// acepta.
//
// Regla nueva del criterio 59 (aprobada por el orquestador): "Todo listo" no toca las líneas de un ítem con
// `esperar = true` que todavía no se marchó (siguen `ENVIADO`, sin `cocina.listo`); las demás pasan a `LISTO`.
// Una vez marchado el ítem (criterio 32: sus líneas originales quedan con `esperar: false`), "Todo listo" sobre
// la comanda original sí las incluye.
import { cocinaRespuestaSchema, type ComandaKds, type LineaKds } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import {
  abrirOrden,
  anularItemOk,
  anularOrdenOk,
  arrancarP2,
  conEventos,
  crearEnCarta,
  enviarOk,
  esperarError,
  exigirEstado,
  INICIO_POR_DEFECTO,
  lineasDe,
  llamar,
  marchar,
  pedirPrecuenta,
  prepararEscenarioP2,
  simpleNuevo,
  verOrden,
  type AppP2,
  type EnvioRespuestaDePrueba,
  type EscenarioP2,
  type ItemDePrueba,
  type OrdenAbierta,
} from './fabrica-p2';
import { auditoriaSalon, instantaneaSalon } from './fabrica-p3';

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
  await sembrarBandejas();
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

// ===================================================================================================
// Ayudantes
// ===================================================================================================

const put = (token: string, ruta: string, cuerpo?: unknown) =>
  llamar(ctx, token, { metodo: 'put', ruta, ...(cuerpo !== undefined ? { cuerpo } : {}) });

/** `GET /cocina/comandas` con Cocina/Barra: exige 200 y devuelve las comandas de la orden (pendientes y recientes). */
async function kdsDe(ordenId: string): Promise<ComandaKds[]> {
  const res = await llamar(ctx, t().cocina, { metodo: 'get', ruta: '/cocina/comandas' });
  expect(res.status, `GET /cocina/comandas: ${res.status} ${res.text}`).toBe(200);
  const r = cocinaRespuestaSchema.parse(res.body);
  return [...r.pendientes, ...r.recientes].filter((c) => c.orden.id === ordenId);
}

/** La comanda del KDS de ese tipo; falla si no está. */
function deTipo(comandas: ComandaKds[], tipo: ComandaKds['tipo']): ComandaKds {
  const c = comandas.find((x) => x.tipo === tipo);
  if (!c) {
    throw new Error(
      `El KDS no muestra una comanda ${tipo}: ${comandas.map((x) => x.tipo).join(', ')}`,
    );
  }
  return c;
}

/** El id de la única línea de una comanda, leído de la base (solo lectura). */
async function lineaIdDe(comandaId: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM comanda_linea WHERE comanda_id = $1 ORDER BY id`,
    [comandaId],
  );
  expect(rows, `líneas de la comanda ${comandaId}`).toHaveLength(1);
  return rows[0]!.id;
}

/** `[estado, cantidad]` de cada línea. */
const formaDeLineas = (c: ComandaKds): [string, number][] =>
  c.lineas.map((l) => [l.estado, l.cantidad]);

const eventosDeListo = (eventos: { nombre: string; datos: unknown }[]) =>
  eventos
    .filter((e) => e.nombre === 'cocina.listo')
    .map((e) => e.datos as { lineaId: string; itemId: string; cantidad: number; ordenId: string });

// Los casos de la regla nueva van antes de F1: una orden con 32967 unidades hace fallar `GET /cocina/comandas`
// de toda la sucursal mientras F1 no esté corregida, y esos casos deben fallar solo por la regla.
// ===================================================================================================
// Regla nueva del criterio 59 · "Todo listo" y los ítems que esperan la marcha
// ===================================================================================================

describe('criterio 59 · Todo listo no toca las líneas de un ítem que todavía espera la marcha', () => {
  /** Lomo 3/4 de segundo tiempo (espera) y Lomo Jugoso × 2 de primer tiempo, en una comanda de Cocina. */
  async function ordenConUnoQueEspera() {
    const o = await abrir();
    const envio = await enviarOk(ctx, t().mozo, o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.lomo(['Jugoso'], 2),
    ]);
    const comanda = deTipo(await kdsDe(o.id), 'COMANDA');
    const espera = comanda.lineas.find((l) => l.modificadores.includes('3/4'))!;
    const normal = comanda.lineas.find((l) => l.modificadores.includes('Jugoso'))!;
    expect(espera).toMatchObject({ esperar: true, estado: 'ENVIADO' });
    expect(normal).toMatchObject({ esperar: false, estado: 'ENVIADO' });
    return { o, envio, comanda, espera, normal };
  }

  const estadoDe = async (ordenId: string, lineaId: string) =>
    deTipo(await kdsDe(ordenId), 'COMANDA').lineas.find((l) => l.id === lineaId)!;

  it('deja ENVIADA la línea que espera, sin evento, y pone en LISTO las demás con su aviso', async () => {
    const { o, comanda, espera, normal } = await ordenConUnoQueEspera();
    const { resultado, eventos } = await conEventos(ctx, () =>
      put(t().cocina, `/cocina/comandas/${comanda.id}/listo`),
    );
    exigirEstado(resultado, 200, 'Todo listo');

    expect(await estadoDe(o.id, espera.id)).toMatchObject({ estado: 'ENVIADO', esperar: true });
    expect(await estadoDe(o.id, normal.id)).toMatchObject({ estado: 'LISTO', cantidad: 2 });

    // Solo la línea que no espera avisa; la que espera no genera ni `cocina.listo` ni `cocina.linea`.
    expect(eventosDeListo(eventos).map((e) => e.lineaId)).toEqual([normal.id]);
    const lineasConEvento = eventos
      .map((e) => (e.datos as { lineaId?: string }).lineaId)
      .filter((id) => id !== undefined);
    expect(lineasConEvento).not.toContain(espera.id);
    // La comanda sigue pendiente (le queda una línea por hacer).
    const res = await llamar(ctx, t().cocina, { metodo: 'get', ruta: '/cocina/comandas' });
    const r = cocinaRespuestaSchema.parse(res.body);
    expect(r.pendientes.map((c) => c.id)).toContain(comanda.id);
  });

  it('repetir Todo listo responde 200 sin cambios ni eventos', async () => {
    const { o, comanda, espera } = await ordenConUnoQueEspera();
    exigirEstado(await put(t().cocina, `/cocina/comandas/${comanda.id}/listo`), 200, 'Todo listo');
    const { resultado, eventos } = await conEventos(ctx, () =>
      put(t().cocina, `/cocina/comandas/${comanda.id}/listo`),
    );
    exigirEstado(resultado, 200, 'Todo listo otra vez');
    expect(eventos).toEqual([]);
    expect(await estadoDe(o.id, espera.id)).toMatchObject({ estado: 'ENVIADO', esperar: true });
  });

  it('una comanda cuyas líneas esperan todas responde 200 y no cambia nada ni publica', async () => {
    const o = await abrir();
    await enviarOk(ctx, t().mozo, o.id, [
      L.lomo(['3/4'], 1, { tiempo: 2 }),
      L.lomo(['Jugoso'], 1, { tiempo: 2 }),
    ]);
    const comanda = deTipo(await kdsDe(o.id), 'COMANDA');
    const { resultado, eventos } = await conEventos(ctx, () =>
      put(t().cocina, `/cocina/comandas/${comanda.id}/listo`),
    );
    exigirEstado(resultado, 200, 'Todo listo');
    expect(eventos).toEqual([]);
    const despues = deTipo(await kdsDe(o.id), 'COMANDA');
    expect(despues.lineas.map((l) => [l.estado, l.esperar])).toEqual([
      ['ENVIADO', true],
      ['ENVIADO', true],
    ]);
  });

  it('una vez marchado el ítem, Todo listo sobre la comanda original sí incluye su línea y avisa', async () => {
    const { o, comanda, espera, normal } = await ordenConUnoQueEspera();
    exigirEstado(await put(t().cocina, `/cocina/comandas/${comanda.id}/listo`), 200, 'Todo listo');
    expect(await estadoDe(o.id, espera.id)).toMatchObject({ estado: 'ENVIADO', esperar: true });

    exigirEstado(await marchar(ctx, t().mozo, o.id, { id: randomUUID() }), 201, 'marchar');
    // Criterio 32: la línea original ya no espera y conserva su estado.
    expect(await estadoDe(o.id, espera.id)).toMatchObject({ estado: 'ENVIADO', esperar: false });

    const { resultado, eventos } = await conEventos(ctx, () =>
      put(t().cocina, `/cocina/comandas/${comanda.id}/listo`),
    );
    exigirEstado(resultado, 200, 'Todo listo tras marchar');
    expect(await estadoDe(o.id, espera.id)).toMatchObject({ estado: 'LISTO', esperar: false });
    expect(await estadoDe(o.id, normal.id)).toMatchObject({ estado: 'LISTO' });
    // Solo la línea que se acaba de marchar cambia: avisa ella sola.
    expect(eventosDeListo(eventos)).toMatchObject([
      { ordenId: o.id, lineaId: espera.id, cantidad: 1 },
    ]);
  });
});

// ===================================================================================================
// F1 · Cantidades que desbordan smallint
// ===================================================================================================

interface Bandeja {
  combo: string;
  componente: string;
  nombreComponente: string;
  nombreCombo: string;
}

/** Combos "Bandeja 33" y "Bandeja 99": un componente simple de Cocina × 33 (o × 99), `"25.00"`. */
const bandejas = new Map<number, Bandeja>();

async function sembrarBandejas(): Promise<void> {
  for (const porBandeja of [33, 99]) {
    const nombreComponente = `Componente de la bandeja ${porBandeja}`;
    const nombreCombo = `Bandeja ${porBandeja}`;
    const componente = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', {
      tipo: 'SIMPLE',
      nombre: nombreComponente,
      familiaId: esc.carta.familiaId,
      seVendeSolo: false,
      estacionId: esc.carta.cocinaId,
      tipoControlStock: 'UNIDADES',
    });
    const combo = await crearEnCarta(ctx, A().tokenAdmin, '/carta/productos', {
      tipo: 'COMBO',
      nombre: nombreCombo,
      familiaId: esc.carta.familiaId,
      precio: '25.00',
      tipoControlStock: 'SIN_CONTROL',
      componentes: [{ productoId: componente.id, cantidad: porBandeja }],
    });
    bandejas.set(porBandeja, {
      combo: combo.id,
      componente: componente.id,
      nombreComponente,
      nombreCombo,
    });
  }
}

/** Abre una mesa y envía `Bandeja N` × 999 con el tiempo dado (exige 201). */
async function ordenConBandeja(
  porBandeja: number,
  tiempo: 1 | 2,
): Promise<{ o: OrdenAbierta; envio: EnvioRespuestaDePrueba; item: ItemDePrueba; b: Bandeja }> {
  const b = bandejas.get(porBandeja)!;
  const o = await abrir();
  const envio = await enviarOk(ctx, t().mozo, o.id, [
    { productoId: b.combo, modificadorIds: [], cantidad: 999, tiempo },
  ]);
  return { o, envio, item: envio.items[0]!, b };
}

const lineaUnica = (c: ComandaKds): LineaKds => {
  expect(c.lineas, `líneas de la comanda ${c.tipo}`).toHaveLength(1);
  return c.lineas[0]!;
};

describe.each([
  { porBandeja: 33, unidades: 32967 },
  { porBandeja: 99, unidades: 98901 },
])(
  'F1 · Bandeja $porBandeja × 999 = $unidades unidades (más de lo que cabe en un smallint)',
  ({ porBandeja, unidades }) => {
    it('el envío responde 201, queda a la estación Cocina y avisa al inventario con la cantidad exacta (criterios 15, 22 y 72)', async () => {
      ctx.inventario.limpiar();
      const { o, envio, item, b } = await ordenConBandeja(porBandeja, 2);
      expect(envio.comandas.map((c) => [c.estacionNombre, c.tipo, c.destino])).toEqual([
        ['Cocina', 'COMANDA', 'KDS'],
      ]);
      expect(item).toMatchObject({
        cantidad: 999,
        cantidadVigente: 999,
        precioUnitario: '25.00',
        totalVigente: '24975.00',
      });
      const orden = await verOrden(ctx, t().mozo, o.id);
      exigirEstado(orden, 200, 'GET /ordenes/:id');
      expect(orden.body.total).toBe('24975.00');
      const llamadas = ctx.inventario.alEnviarLlamadas();
      expect(llamadas).toHaveLength(1);
      const parte = llamadas[0]!.partes.find((p) => p.productoId === b.componente);
      expect(parte, 'parte de stock del componente').toMatchObject({ cantidad: unidades });
    });

    it('GET /cocina/comandas responde 200 con la cantidad exacta de la línea (criterios 56 y 57)', async () => {
      const { o, b } = await ordenConBandeja(porBandeja, 2);
      const comandas = await kdsDe(o.id);
      expect(comandas.map((c) => c.tipo)).toEqual(['COMANDA']);
      const linea = lineaUnica(comandas[0]!);
      expect(linea).toMatchObject({
        rol: 'COMPONENTE',
        nombre: b.nombreComponente,
        contexto: b.nombreCombo,
        cantidad: unidades,
        tiempo: 2,
        esperar: true,
        estado: 'ENVIADO',
      });
    });

    it('PUT /cocina/lineas/:id/estado responde 200 en cada estado y avisa con la cantidad exacta (criterios 58 y 60)', async () => {
      const { o, envio } = await ordenConBandeja(porBandeja, 1);
      // El id de la línea se lee de la base para que esta prueba no dependa de `GET /cocina/comandas`.
      const lineaId = await lineaIdDe(envio.comandas[0]!.id);

      for (const estado of ['EN_PREPARACION', 'ENVIADO'] as const) {
        const res = await put(t().cocina, `/cocina/lineas/${lineaId}/estado`, { estado });
        exigirEstado(res, 200, `estado ${estado}`);
        const ahora = lineaUnica(deTipo(await kdsDe(o.id), 'COMANDA'));
        expect([ahora.id, ahora.estado, ahora.cantidad]).toEqual([lineaId, estado, unidades]);
      }

      const { resultado, eventos } = await conEventos(ctx, () =>
        put(t().cocina, `/cocina/lineas/${lineaId}/estado`, { estado: 'LISTO' }),
      );
      exigirEstado(resultado, 200, 'estado LISTO');
      expect(eventosDeListo(eventos)).toMatchObject([
        { ordenId: o.id, lineaId, cantidad: unidades },
      ]);
      const despues = lineaUnica(deTipo(await kdsDe(o.id), 'COMANDA'));
      expect([despues.estado, despues.cantidad]).toEqual(['LISTO', unidades]);
    });

    it('PUT /cocina/comandas/:id/listo responde 200 y deja la línea LISTO con la cantidad exacta (criterio 59)', async () => {
      const { o, envio } = await ordenConBandeja(porBandeja, 1);
      const comandaId = envio.comandas[0]!.id;
      const { resultado, eventos } = await conEventos(ctx, () =>
        put(t().cocina, `/cocina/comandas/${comandaId}/listo`),
      );
      exigirEstado(resultado, 200, 'Todo listo');
      expect(eventosDeListo(eventos)).toMatchObject([{ ordenId: o.id, cantidad: unidades }]);
      const despues = deTipo(await kdsDe(o.id), 'COMANDA');
      expect(formaDeLineas(despues)).toEqual([['LISTO', unidades]]);
    });

    it('marchar responde 201 y la comanda MARCHAR trae la cantidad exacta; después, Todo listo y Visto responden 200 (criterios 32 y 59)', async () => {
      const { o, item, b } = await ordenConBandeja(porBandeja, 2);
      const id = randomUUID();
      const res = await marchar(ctx, t().mozo, o.id, { id });
      exigirEstado(res, 201, 'marchar');
      expect(res.body.id).toBe(id);
      expect(res.body.comandas.map((c: { tipo: string }) => c.tipo)).toEqual(['MARCHAR']);

      const comandas = await kdsDe(o.id);
      const marcha = deTipo(comandas, 'MARCHAR');
      expect(lineaUnica(marcha)).toMatchObject({
        nombre: b.nombreComponente,
        cantidad: unidades,
        estado: 'ENVIADO',
      });
      // La línea original ya no espera y conserva su cantidad.
      const original = deTipo(comandas, 'COMANDA');
      expect(lineaUnica(original)).toMatchObject({ cantidad: unidades, esperar: false });
      const orden = await verOrden(ctx, t().mozo, o.id);
      exigirEstado(orden, 200, 'GET /ordenes/:id');
      expect(
        (orden.body.items as ItemDePrueba[]).find((i) => i.id === item.id)?.marchadoEn,
      ).not.toBeNull();

      // Con el ítem marchado, Todo listo sobre la comanda original incluye su línea.
      const listo = await put(t().cocina, `/cocina/comandas/${original.id}/listo`);
      exigirEstado(listo, 200, 'Todo listo tras marchar');
      expect(formaDeLineas(deTipo(await kdsDe(o.id), 'COMANDA'))).toEqual([['LISTO', unidades]]);

      // La comanda MARCHAR se marca vista.
      const visto = await put(t().cocina, `/cocina/comandas/${marcha.id}/visto`);
      exigirEstado(visto, 200, 'Visto de la marcha');
      expect(deTipo(await kdsDe(o.id), 'MARCHAR').vistaEn).not.toBeNull();
    });

    it('anular el ítem entero (999) responde 201 y la comanda ANULACION trae la cantidad exacta (criterios 35, 38 y 72)', async () => {
      const { o, item, b } = await ordenConBandeja(porBandeja, 1);
      ctx.inventario.limpiar();
      const res = await anularItemOk(ctx, t().supervisor, o.id, item.id, 999, 'MERMA');
      expect(res.body).toMatchObject({
        itemId: item.id,
        cantidad: 999,
        destinoStock: 'MERMA',
        item: { cantidadAnulada: 999, cantidadVigente: 0, estado: 'ANULADO', totalVigente: '0.00' },
      });
      expect(res.body.comandas.map((c: { tipo: string }) => c.tipo)).toEqual(['ANULACION']);

      const llamadas = ctx.inventario.alAnularLlamadas();
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0]).toMatchObject({ destino: 'MERMA' });
      const parte = llamadas[0]!.partes.find((p) => p.productoId === b.componente);
      expect(parte, 'parte de stock del componente').toMatchObject({ cantidad: unidades });

      const comandas = await kdsDe(o.id);
      const anulacion = deTipo(comandas, 'ANULACION');
      expect(lineaUnica(anulacion)).toMatchObject({
        nombre: b.nombreComponente,
        cantidad: unidades,
      });
      expect(anulacion.motivo).toBe('Anulación de prueba');
      // La línea original pasa a ANULADO.
      expect(lineaUnica(deTipo(comandas, 'COMANDA')).estado).toBe('ANULADO');

      const visto = await put(t().cocina, `/cocina/comandas/${anulacion.id}/visto`);
      exigirEstado(visto, 200, 'Visto de la anulación');
      const orden = await verOrden(ctx, t().mozo, o.id);
      exigirEstado(orden, 200, 'GET /ordenes/:id');
      expect(orden.body.total).toBe('0.00');
    });

    it('anular un ítem enviado en dos tiempos (998 y 1) deja cada ticket con su cantidad exacta (criterios 35 y 38)', async () => {
      const { o, item, b } = await ordenConBandeja(porBandeja, 1);
      await anularItemOk(ctx, t().supervisor, o.id, item.id, 998);
      await anularItemOk(ctx, t().supervisor, o.id, item.id, 1);
      const anulaciones = (await kdsDe(o.id)).filter((c) => c.tipo === 'ANULACION');
      expect(anulaciones.map((c) => [c.lineas[0]!.nombre, c.lineas[0]!.cantidad]).sort()).toEqual(
        [
          [b.nombreComponente, 998 * porBandeja],
          [b.nombreComponente, porBandeja],
        ].sort(),
      );
    });

    it('anular la orden responde 200 y la comanda ANULACION trae la cantidad exacta (criterio 42)', async () => {
      const { o, b } = await ordenConBandeja(porBandeja, 2);
      ctx.inventario.limpiar();
      const res = await anularOrdenOk(ctx, t().supervisor, o.id, 'MERMA');
      expect(res.body).toMatchObject({ id: o.id, estado: 'ANULADA' });
      expect(res.body.items[0]).toMatchObject({ cantidadAnulada: 999, cantidadVigente: 0 });

      const llamadas = ctx.inventario.alAnularLlamadas();
      expect(llamadas).toHaveLength(1);
      const parte = llamadas[0]!.partes.find((p) => p.productoId === b.componente);
      expect(parte, 'parte de stock del componente').toMatchObject({ cantidad: unidades });

      const anulacion = deTipo(await kdsDe(o.id), 'ANULACION');
      expect(lineaUnica(anulacion)).toMatchObject({
        nombre: b.nombreComponente,
        cantidad: unidades,
      });
    });
  },
);

// ===================================================================================================
// F2 · Unir mesas pasa el tope del total
// ===================================================================================================

describe('F2 · unir mesas ocupadas cuyas cuentas juntas pasan de 99999999.99 (criterios 21, 47 y 50)', () => {
  const TOPE = '99999999.99';
  let caro: string;
  let mitadA: string;
  let mitadB: string;

  beforeAll(async () => {
    const crear = async (precio: string): Promise<string> =>
      (
        await crearEnCarta(
          ctx,
          A().tokenAdmin,
          '/carta/productos',
          simpleNuevo(esc.carta, { precio }),
        )
      ).id;
    caro = await crear('60000000.00');
    mitadA = await crear('50000000.00');
    mitadB = await crear('49999999.99');
  });

  const unaUnidad = (productoId: string) => ({ productoId, modificadorIds: [], cantidad: 1 });

  const unir = (ordenId: string, mesaIds: string[]) =>
    llamar(ctx, t().mozo, {
      metodo: 'post',
      ruta: `/ordenes/${ordenId}/union`,
      cuerpo: { mesaIds },
    });

  /** Dos órdenes abiertas con 1 unidad de un producto cada una. */
  async function dosOrdenes(productoO1: string, productoO2: string) {
    const o1 = await abrir();
    const o2 = await abrir();
    await enviarOk(ctx, t().mozo, o1.id, [unaUnidad(productoO1)]);
    await enviarOk(ctx, t().mozo, o2.id, [unaUnidad(productoO2)]);
    return { o1, o2 };
  }

  const ordenDe = async (id: string) => {
    const res = await verOrden(ctx, t().mozo, id);
    exigirEstado(res, 200, 'GET /ordenes/:id');
    return res.body as {
      estado: string;
      total: string;
      unidaA: string | null;
      mesas: { id: string }[];
      items: { id: string; estado: string }[];
      precuentaVigente: unknown;
    };
  };

  const filasUnir = async (ordenId?: string) =>
    (await auditoriaSalon(admin, A().empresaId, { accion: 'unir_ordenes' })).filter(
      (f) => ordenId === undefined || f.entidad_id === ordenId,
    );

  it('responde 422 MONTO_FUERA_DE_RANGO y no cambia nada: ni órdenes, ni ítems, ni mesas, ni auditoría, ni eventos', async () => {
    const { o1, o2 } = await dosOrdenes(caro, caro);
    expect((await ordenDe(o1.id)).total).toBe('60000000.00');
    expect((await ordenDe(o2.id)).total).toBe('60000000.00');

    const foto = await instantaneaSalon(admin, A().empresaId);
    const filasAntes = await filasUnir();
    ctx.inventario.limpiar();
    const { resultado, eventos } = await conEventos(ctx, () => unir(o1.id, [o2.mesaId]));

    esperarError(resultado, 422, 'MONTO_FUERA_DE_RANGO');
    expect(eventos).toEqual([]);
    expect(ctx.inventario.llamadas()).toEqual([]);
    expect(await instantaneaSalon(admin, A().empresaId)).toEqual(foto);
    expect(await filasUnir()).toEqual(filasAntes);

    // Las dos órdenes siguen abiertas, cada una con su ítem y su mesa.
    for (const o of [o1, o2]) {
      const orden = await ordenDe(o.id);
      expect(orden).toMatchObject({ estado: 'ABIERTA', total: '60000000.00', unidaA: null });
      expect(orden.items).toHaveLength(1);
      expect(orden.mesas.map((m) => m.id)).toEqual([o.mesaId]);
    }
    const salon = await llamar(ctx, t().mozo, { metodo: 'get', ruta: '/salon' });
    exigirEstado(salon, 200, 'GET /salon');
    const mesas = (
      salon.body.zonas as {
        mesas: { id: string; estado: string; orden: { id: string } | null }[];
      }[]
    ).flatMap((z) => z.mesas);
    for (const o of [o1, o2]) {
      expect(mesas.find((m) => m.id === o.mesaId)).toMatchObject({
        estado: 'OCUPADA',
        orden: { id: o.id },
      });
    }
  });

  it('también se rechaza al unir en el otro sentido, y repetirlo da lo mismo', async () => {
    const { o1, o2 } = await dosOrdenes(caro, caro);
    const foto = await instantaneaSalon(admin, A().empresaId);
    esperarError(await unir(o2.id, [o1.mesaId]), 422, 'MONTO_FUERA_DE_RANGO');
    esperarError(await unir(o2.id, [o1.mesaId]), 422, 'MONTO_FUERA_DE_RANGO');
    esperarError(await unir(o1.id, [o2.mesaId]), 422, 'MONTO_FUERA_DE_RANGO');
    expect(await instantaneaSalon(admin, A().empresaId)).toEqual(foto);
    expect((await ordenDe(o1.id)).estado).toBe('ABIERTA');
    expect((await ordenDe(o2.id)).estado).toBe('ABIERTA');
  });

  it('con la orden principal en pre-cuenta, el rechazo la deja en pre-cuenta y la pre-cuenta de la principal sigue respondiendo 201', async () => {
    const { o1, o2 } = await dosOrdenes(caro, caro);
    const antes = await pedirPrecuenta(ctx, t().mozo, o1.id);
    exigirEstado(antes, 201, 'pre-cuenta antes de unir');
    expect(antes.body.total).toBe('60000000.00');

    esperarError(await unir(o1.id, [o2.mesaId]), 422, 'MONTO_FUERA_DE_RANGO');
    // La pre-cuenta no se invalidó: la orden sigue en pre-cuenta con la misma pre-cuenta vigente.
    const orden = await ordenDe(o1.id);
    expect(orden.estado).toBe('EN_PRECUENTA');
    expect(orden.precuentaVigente).toMatchObject({ id: antes.body.id, numero: antes.body.numero });

    // Pedirla otra vez devuelve la vigente (criterio 52) y la de la otra orden también responde 201.
    exigirEstado(await pedirPrecuenta(ctx, t().mozo, o1.id), 201, 'pre-cuenta de la principal');
    const deO2 = await pedirPrecuenta(ctx, t().mozo, o2.id);
    exigirEstado(deO2, 201, 'pre-cuenta de la otra orden');
    expect(deO2.body.total).toBe('60000000.00');
  });

  it('con totales que juntos quedan justo en el tope (99999999.99) la unión se acepta', async () => {
    const { o1, o2 } = await dosOrdenes(mitadA, mitadB);
    expect((await ordenDe(o1.id)).total).toBe('50000000.00');
    expect((await ordenDe(o2.id)).total).toBe('49999999.99');

    const filasAntes = await filasUnir();
    const { resultado, eventos } = await conEventos(ctx, () => unir(o1.id, [o2.mesaId]));
    exigirEstado(resultado, 200, 'unir en el tope');
    expect(eventos.map((e) => e.nombre)).toContain('salon.cambio');

    expect(await ordenDe(o1.id)).toMatchObject({ estado: 'ABIERTA', total: TOPE });
    expect((await ordenDe(o1.id)).items).toHaveLength(2);
    expect((await ordenDe(o1.id)).mesas.map((m) => m.id).sort()).toEqual(
      [o1.mesaId, o2.mesaId].sort(),
    );
    expect(await ordenDe(o2.id)).toMatchObject({ estado: 'UNIDA', unidaA: o1.id });
    // La unión deja exactamente una fila de auditoría `unir_ordenes` (criterio 47).
    expect(await filasUnir()).toHaveLength(filasAntes.length + 1);

    // La pre-cuenta de la orden unida lleva el total exacto del tope.
    const precuenta = await pedirPrecuenta(ctx, t().mozo, o1.id);
    exigirEstado(precuenta, 201, 'pre-cuenta de la orden unida');
    expect(precuenta.body.total).toBe(TOPE);
  });

  it('un centavo más allá del tope (50000000.00 + 50000000.00) se rechaza y la principal no cambia', async () => {
    const { o1, o2 } = await dosOrdenes(mitadA, mitadA);
    const foto = await instantaneaSalon(admin, A().empresaId);
    esperarError(await unir(o1.id, [o2.mesaId]), 422, 'MONTO_FUERA_DE_RANGO');
    expect(await instantaneaSalon(admin, A().empresaId)).toEqual(foto);
    expect(await ordenDe(o1.id)).toMatchObject({ estado: 'ABIERTA', total: '50000000.00' });
    expect(await ordenDe(o2.id)).toMatchObject({ estado: 'ABIERTA', total: '50000000.00' });
  });
});
