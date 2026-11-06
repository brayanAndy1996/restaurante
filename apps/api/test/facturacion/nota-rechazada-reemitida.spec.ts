// Pruebas del desarrollador (6b, T40): una nota de crédito rechazada y su reemisión cuentan una sola vez. La que reemplazó una
// reemisión no cuenta (criterios 136 y 148): ni para lo que queda por acreditar, ni para las notas del X y de la Z, ni para
// el `acreditado` y las `notasCredito` del original.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  api,
  cerrarAdmin,
  crearEscenario,
  escribir,
  exigir,
  type Escenario,
} from '../caja-critica/fabrica-caja';
import {
  arrancarNotas,
  comprobanteDe,
  efectivo,
  emitirAceptado,
  emitirNota,
  notaCrudo,
  cuerpoNota,
  prepararNotas,
  type AppNotas,
  type Libre,
} from '../facturacion-critica/fabrica-notas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppNotas;
let esc: Escenario;
const sup = () => esc.A.token.supervisor!;

beforeAll(async () => {
  ctx = await arrancarNotas();
  esc = await crearEscenario(ctx);
  await prepararNotas(ctx, esc);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

describe('una nota rechazada y su reemisión', () => {
  it('cuentan una sola vez en las notas del X, en lo acreditado y en lo que queda por acreditar', async () => {
    const o = await emitirAceptado(ctx, esc.A);
    const lomo = (o.cobro.comprobante as Libre).lineas.find((l: Libre) =>
      /Lomo/.test(l.descripcion),
    ).posicion as number;
    const nota = (
      await emitirNota(ctx, sup(), {
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: lomo, cantidad: 1 }],
        devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
      })
    ).nota as Libre;

    // Rechazada sin reemisión: sigue contando (su dinero ya se devolvió).
    ctx.simulador.reglas.rechazarNumero(nota.numero, { codigo: '2800', mensaje: 'Rechazo' });
    try {
      await ctx.procesar(esc.A.id, nota.id);
    } finally {
      ctx.simulador.reglas.limpiar();
    }
    const antes = await api(ctx, sup(), 'get', `/turnos/${o.turnoId}/reporte`);
    exigir(antes, 200, 'Reporte X');
    expect(antes.body.notasCredito).toEqual({ cantidad: 1, total: '28.00', devuelto: '28.00' });

    // Con su reemisión: cuenta la nueva y no la rechazada.
    const reemision = await escribir(
      ctx,
      sup(),
      'post',
      `/facturacion/comprobantes/${nota.id}/reemision`,
      { tipo: 'NOTA_CREDITO_BOLETA' },
      { 'Idempotency-Key': randomUUID() },
    );
    exigir(reemision, 201, 'Emitir otro (criterio 134)');
    const nueva = reemision.body.comprobante as Libre;
    const despues = await api(ctx, sup(), 'get', `/turnos/${o.turnoId}/reporte`);
    exigir(despues, 200, 'Reporte X');
    expect(despues.body.notasCredito).toEqual({ cantidad: 1, total: '28.00', devuelto: '28.00' });
    expect(despues.body.esperado.find((e: Libre) => e.medio === 'EFECTIVO').monto).toBe('241.20');

    const original = await comprobanteDe(ctx, sup(), o.comprobanteId);
    expect(original.notasCredito.map((n: Libre) => n.id)).toEqual([nueva.id]);
    expect(original.acreditado).toEqual([
      expect.objectContaining({ posicion: lomo, cantidad: 1, neto: '28.00' }),
    ]);

    // La otra unidad todavía se puede devolver; la primera ya no (ni por la rechazada ni por su reemisión).
    const repetida = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '56.00',
        lineas: [{ posicion: lomo, cantidad: 2 }],
      }),
    );
    expect(repetida.status).toBe(422);
    const otra = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: lomo, cantidad: 1 }],
    });
    expect((otra.nota as Libre).totales.total).toBe('28.00');
  });
});
