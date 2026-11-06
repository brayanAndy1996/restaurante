// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · 6a sigue igual en sus pruebas (ruta crítica), criterio 137:
// - con `NODE_ENV=test` `crearAplicacion` usa la cola en memoria, que guarda los trabajos sin procesarlos, y no arranca el
//   barrido ni el worker: un cobro (y una venta de mostrador) deja el comprobante `POR_ENVIAR`, su envío `PENDIENTE` y un
//   trabajo `envio-pse` en la cola con solo `{ empresaId, comprobanteId }`, y el PSE no recibe nada, por mucho que pase
//   el tiempo;
// - ninguna ruta lo cambia: consultar, listar o pedir un reintento manual no mueve el estado ni llama al PSE;
//   solo el worker (aquí, el procesador llamado a mano) lo deja `ACEPTADO`.
// Se usa un emisor **sin** configuración de PSE (criterio 122: emite igual) y, para el contraste, el emisor E1 de A en
// `SIMULADO`.
// Hoy falla porque `envio_pse` no existe (el envío se registra en la emisión, criterio 124).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  activarSimulado,
  api,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  escribir,
  esperar,
  estadoDe,
  exigirEstado,
  procesarCola,
  turnoDe,
  venderMostrador,
  type AppFact,
  type Escenario,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarFact();
  // Sin configuración de PSE en ningún emisor: así la emisión de 6a no depende de 6b.
  esc = await crearEscenarioFact(ctx, { conPse: false });
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

const trabajosDe = (comprobanteId: string) =>
  ctx.cola.pendientes().filter((t) => t.comprobanteId === comprobanteId);

describe('criterio 137 · con NODE_ENV=test nada se procesa solo', () => {
  it('un cobro deja el comprobante POR_ENVIAR, el envío PENDIENTE y el trabajo en la cola sin procesar', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarLomo(ctx, A(), { turnoId });
    expect(await estadoDe(comprobanteId)).toBe('POR_ENVIAR');
    const envio = await envioDe(comprobanteId);
    expect(envio, 'el envío se registra en la emisión (criterio 124)').toBeDefined();
    expect(envio).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    // La cola en memoria guarda el trabajo, con solo los dos ids (criterio 163), sin procesarlo.
    const trabajos = trabajosDe(comprobanteId);
    expect(trabajos).toHaveLength(1);
    expect({ ...trabajos[0]! }).toMatchObject({ empresaId: A().id, comprobanteId });
    expect(
      Object.keys(trabajos[0]!)
        .filter((k) => k !== 'startAfter')
        .sort(),
    ).toEqual(['comprobanteId', 'empresaId']);
    expect(ctx.pse.llamadas()).toEqual([]);
  });

  it('una venta de mostrador hace lo mismo', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const comprobanteId = await venderMostrador(ctx, A(), turnoId);
    expect(await estadoDe(comprobanteId)).toBe('POR_ENVIAR');
    expect(await envioDe(comprobanteId)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    expect(trabajosDe(comprobanteId)).toHaveLength(1);
    expect(ctx.pse.llamadas()).toEqual([]);
  });

  it('pasa el tiempo (real y del reloj de la API) y el comprobante sigue POR_ENVIAR con su trabajo en la cola', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarLomo(ctx, A(), { turnoId });
    await esperar(1500);
    ctx.reloj.avanzar(5_000);
    await esperar(500);
    expect(await estadoDe(comprobanteId)).toBe('POR_ENVIAR');
    expect(await envioDe(comprobanteId)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    expect(trabajosDe(comprobanteId)).toHaveLength(1);
    expect(ctx.pse.llamadas()).toEqual([]);
    expect(ctx.almacenC.claves().filter((k) => k.includes(comprobanteId))).toEqual([]);
  });

  it('ninguna ruta lo cambia: consultar, listar o pedir un reintento manual no mueve el estado ni llama al PSE', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarLomo(ctx, A(), { turnoId });
    const antes = trabajosDe(comprobanteId).length;
    const t = A().token;
    exigirEstado(await api(ctx, t.cajero, 'get', `/comprobantes/${comprobanteId}`), 200, 'detalle');
    exigirEstado(
      await api(ctx, t.supervisor, 'get', `/comprobantes?turnoId=${turnoId}`),
      200,
      'lista',
    );
    exigirEstado(
      await api(ctx, t.supervisor, 'get', `/facturacion/comprobantes/${comprobanteId}`),
      200,
      'detalle del panel (criterio 135)',
    );
    exigirEstado(
      await escribir(
        ctx,
        t.supervisor,
        'post',
        `/facturacion/comprobantes/${comprobanteId}/reintento`,
      ),
      202,
      'reintento manual (criterio 132)',
    );
    expect(await estadoDe(comprobanteId)).toBe('POR_ENVIAR');
    expect(ctx.pse.llamadas()).toEqual([]);
    expect(await envioDe(comprobanteId)).toMatchObject({ intentos: 0 });
    expect(trabajosDe(comprobanteId).length).toBeGreaterThanOrEqual(antes);
  });

  it('solo el worker lo cambia: al correr el procesador a mano, con el emisor en SIMULADO, queda ACEPTADO', async () => {
    await activarSimulado(ctx, esc, A(), A().emisor1);
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarLomo(ctx, A(), { turnoId });
    expect(await estadoDe(comprobanteId)).toBe('POR_ENVIAR');
    const procesados = await procesarCola(ctx, [A().id]);
    expect(procesados).toBeGreaterThanOrEqual(1);
    expect(await estadoDe(comprobanteId)).toBe('ACEPTADO');
    expect((await comprobanteFila(comprobanteId)).simulado).toBe(true);
    expect(await envioDe(comprobanteId)).toMatchObject({ estado: 'TERMINADO' });
  });
});
