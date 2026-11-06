// Pruebas del desarrollador (6b, T31): `intento_pse.numero` es el de la llamada dentro del envío (glosario, "Intento"). Un
// trabajo que consulta y luego emite hace dos llamadas con dos números, y el detalle del comprobante las ordena por ese
// número, del más nuevo al más antiguo, sin depender de la hora ni del id (criterio 135).
import { comprobanteDetalleSchema } from '@restaurante/contratos';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  crearEscenarioFact,
  envioDe,
  exigirEstado,
  exigirPse,
  intentosDe,
  limitarBarrido,
  procesar,
  turnoDe,
  type AppFact,
  type Escenario,
} from '../facturacion-critica/fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let restaurarBarrido: () => void;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  ctx.pse.reglas.limpiar();
});

describe('criterio 131 · el número del intento es el de la llamada dentro del envío', () => {
  it('la consulta y la emisión de un mismo trabajo llevan números distintos y consecutivos', async () => {
    const turnoId = await turnoDe(ctx, esc.A, 'cajero', 'S1', 'caja1');
    const c = await cobrarLomo(ctx, esc.A, { turnoId });
    // Dos fallos de transmisión; el tercer trabajo consulta (NO_EXISTE) y emite en la misma pasada.
    ctx.pse.reglas.fallarTransmision(2);
    for (const espera of [60_000, 2 * 60_000, 0]) {
      await procesar(ctx, esc.A.id, c.comprobanteId);
      ctx.reloj.avanzar(espera);
    }
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio).toMatchObject({ estado: 'TERMINADO', intentos: 3 });

    const intentos = await intentosDe(c.comprobanteId);
    const llamadas = ctx.pse.llamadas().length;
    expect(intentos).toHaveLength(llamadas);
    expect(intentos.map((i) => i.numero)).toEqual(intentos.map((_, i) => i + 1));
    expect(intentos.at(-1)).toMatchObject({ resultado: 'ACEPTADO' });
    expect(intentos.length).toBeGreaterThan(envio.intentos as number);

    const res = await api(
      ctx,
      esc.A.token.supervisor,
      'get',
      `/facturacion/comprobantes/${c.comprobanteId}`,
    );
    exigirEstado(res, 200, 'GET /facturacion/comprobantes/:id (criterio 135)');
    const detalle = comprobanteDetalleSchema.parse(res.body);
    expect(detalle.intentos.map((i) => i.numero)).toEqual(intentos.map((i) => i.numero).reverse());
    expect(detalle.intentos[0]).toMatchObject({ resultado: 'ACEPTADO' });
  });
});
