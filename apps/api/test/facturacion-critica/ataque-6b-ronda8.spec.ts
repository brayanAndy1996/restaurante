// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 8)
//
// Ataque adversarial a la entrega 6b, ronda 8 (criterios 144 a 153 y 177): lo que la API real responde lo lee la PWA con los
// esquemas de `packages/contratos`; si no cuadran, la hoja de la nota no puede mostrar la nota que ya salió.
// - Las respuestas de `POST /notas-credito` (emisión con devolución, réplica por clave de idempotencia, réplica por `id`,
//   anulación sin devolución, anulación con devolución del Cajero con clave, cambio a factura) cumplen `notaCreditoRespuestaSchema`.
// - `GET /facturacion/comprobantes/:id` del original, de la nota y de la factura nueva cumple `comprobanteDetalleSchema`.
//
// Estas pruebas pueden pasar hoy y quedan de regresión del contrato entre la API y la PWA.
import { randomUUID } from 'node:crypto';
import { comprobanteDetalleSchema, notaCreditoRespuestaSchema } from '@restaurante/contratos';
import type { ZodType } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autorizarNota,
  cuerpoNota,
  efectivo,
  emitirAceptado,
  notaCrudo,
  objetivoNota,
  prepararNotas,
  yape,
  type AppNotas,
} from './fabrica-notas';
import {
  api,
  arrancarFact,
  CLIENTE_RUC,
  cerrarAdmin,
  crearEscenarioFact,
  exigirPse,
  type AppFact,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let ctx: AppFact;
let notas: AppNotas;
let esc: Escenario;
const A = () => esc.A;
const supervisor = () => A().token.supervisor!;
const cajero = () => A().token.cajero!;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  notas = {
    ...ctx,
    simulador: ctx.pse,
    almacenComprobantes: ctx.almacenC,
    procesar: (empresaId, comprobanteId) => ctx.procesador.procesar(empresaId, comprobanteId),
  };
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  await prepararNotas(notas, esc);
  await A().refrescarSesiones();
});

/** Exige que el cuerpo cumpla el esquema, y dice qué campos no cuadran si no. */
function cumple(que: string, esquema: ZodType, cuerpo: unknown): void {
  const r = esquema.safeParse(cuerpo);
  expect(
    r.success,
    `${que}: ${r.success ? '' : JSON.stringify(r.error.issues).slice(0, 1500)}`,
  ).toBe(true);
}

const posicionDe = (comprobante: Libre, descripcion: RegExp): number =>
  (comprobante.lineas as Libre[]).find((l) => descripcion.test(l.descripcion as string))!
    .posicion as number;

const detalle = async (id: string): Promise<unknown> => {
  const res = await api(notas, supervisor(), 'get', `/facturacion/comprobantes/${id}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe('ronda 8 · las respuestas reales de las notas cumplen los esquemas que lee la PWA', () => {
  it('devolución en Yape: la emisión, la réplica por clave de idempotencia y la réplica por id cumplen notaCreditoRespuestaSchema, y el detalle del original y de la nota cumplen comprobanteDetalleSchema', async () => {
    const original = await emitirAceptado(notas, A(), {});
    const cuerpo = cuerpoNota({
      id: randomUUID(),
      comprobanteId: original.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '9.00',
      lineas: [{ posicion: posicionDe(original.cobro.comprobante, /Gaseosa/), cantidad: 1 }],
      devolucion: {
        turnoId: original.turnoId,
        pagos: [yape('9.00', 'OP-DEV-1')],
        redondeo: '0.00',
      },
    });
    const ik = randomUUID();
    const emision = await notaCrudo(notas, supervisor(), cuerpo, { ik });
    expect(emision.status, JSON.stringify(emision.body)).toBe(201);
    cumple('emisión con devolución en Yape', notaCreditoRespuestaSchema, emision.body);

    const replicaIk = await notaCrudo(notas, supervisor(), cuerpo, { ik });
    expect(replicaIk.status, JSON.stringify(replicaIk.body)).toBe(201);
    cumple('réplica por clave de idempotencia', notaCreditoRespuestaSchema, replicaIk.body);

    const replicaId = await notaCrudo(notas, supervisor(), { ...cuerpo, motivo: 'Otro motivo' });
    expect(replicaId.status, JSON.stringify(replicaId.body)).toBe(201);
    cumple('réplica por id', notaCreditoRespuestaSchema, replicaId.body);

    cumple('detalle del original', comprobanteDetalleSchema, await detalle(original.comprobanteId));
    cumple(
      'detalle de la nota',
      comprobanteDetalleSchema,
      await detalle((emision.body as Libre).nota.id as string),
    );
  });

  it('anulación del Cajero con clave y devolución en efectivo, y anulación sin devolución, cumplen notaCreditoRespuestaSchema', async () => {
    const total = '69.20';
    const conDevolucion = await emitirAceptado(notas, A(), {});
    const clave = await autorizarNota(
      notas,
      cajero(),
      A().personas.supervisor!.pin,
      objetivoNota(conDevolucion.comprobanteId, 'ANULACION', total, total),
    );
    const resCajero = await notaCrudo(
      notas,
      cajero(),
      cuerpoNota({
        comprobanteId: conDevolucion.comprobanteId,
        tipo: 'ANULACION',
        total,
        devolucion: {
          turnoId: conDevolucion.turnoId,
          pagos: [efectivo(total)],
          redondeo: '0.00',
        },
      }),
      { autorizacion: clave.autorizacionId },
    );
    expect(resCajero.status, JSON.stringify(resCajero.body)).toBe(201);
    cumple(
      'anulación con devolución en efectivo (Cajero)',
      notaCreditoRespuestaSchema,
      resCajero.body,
    );

    const sinDevolucion = await emitirAceptado(notas, A(), {});
    const res = await notaCrudo(
      notas,
      supervisor(),
      cuerpoNota({
        comprobanteId: sinDevolucion.comprobanteId,
        tipo: 'ANULACION',
        total,
        devolucion: null,
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    cumple('anulación sin devolución', notaCreditoRespuestaSchema, res.body);
  });

  it('cambio de boleta por factura: la respuesta cumple notaCreditoRespuestaSchema y el detalle del original y de la factura nueva cumplen comprobanteDetalleSchema', async () => {
    const original = await emitirAceptado(notas, A(), {});
    const res = await notaCrudo(
      notas,
      supervisor(),
      cuerpoNota({
        comprobanteId: original.comprobanteId,
        tipo: 'CAMBIO_A_FACTURA',
        total: '69.20',
        cliente: CLIENTE_RUC,
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    cumple('cambio a factura', notaCreditoRespuestaSchema, res.body);
    cumple(
      'detalle de la boleta cambiada',
      comprobanteDetalleSchema,
      await detalle(original.comprobanteId),
    );
    cumple(
      'detalle de la factura nueva',
      comprobanteDetalleSchema,
      await detalle((res.body as Libre).factura.id as string),
    );
  });
});
