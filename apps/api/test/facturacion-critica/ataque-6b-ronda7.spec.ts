// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 7)
//
// Ataque adversarial a la entrega 6b, ronda 7 (criterios 145, 153 y 154 y el orden de rechazos de las escrituras): en
// `POST /notas-credito` la réplica por `id` va antes del 403 de clave. Con un `id` de nota ya emitido y la misma huella, una
// autorización VENCIDA o YA USADA no cambia nada: 201 con la nota ya emitida, sin consumir ni auditar nada; con otra huella,
// 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA` sin consumir tampoco. Un 403 de clave sobre la nota significa, por tanto, que ese `id`
// no existe (y la PWA conserva el `id` ante ese 403: ver `apps/app/test/nota-credito-ataque-r7.spec.tsx`).
//
// Estas pruebas protegen lo que la ronda 3 (C1) ya arregló; pueden pasar hoy y quedan de regresión.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  autorizarNota,
  contarFilas,
  cuerpoNota,
  emitirAceptado,
  notaCrudo,
  notasDelOriginal,
  objetivoNota,
  prepararNotas,
  type AppNotas,
} from './fabrica-notas';
import {
  arrancarFact,
  avanzar,
  cerrarAdmin,
  crearEscenarioFact,
  esperarError,
  exigirPse,
  filas,
  type AppFact,
  type Escenario,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

let ctx: AppFact;
let notas: AppNotas;
let esc: Escenario;
const A = () => esc.A;
const cajero = () => A().token.cajero!;
const pinSupervisor = () => A().personas.supervisor!.pin;

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

const auditoriaDeLaEmpresa = (): Promise<number> =>
  contarFilas('SELECT 1 FROM auditoria WHERE empresa_id = $1', [A().id]);
const usadaEn = async (autorizacionId: string): Promise<unknown> =>
  (await filas('SELECT usada_en FROM autorizacion WHERE id = $1', [autorizacionId]))[0]?.usada_en;

/** Una boleta aceptada y su anulación ya emitida por el Cajero con la clave de un supervisor (que queda usada). */
async function notaYaEmitida() {
  const original = await emitirAceptado(notas, A(), {});
  const total = '69.20';
  const clave = await autorizarNota(
    notas,
    cajero(),
    pinSupervisor(),
    objetivoNota(original.comprobanteId, 'ANULACION', total),
  );
  const cuerpo = cuerpoNota({
    id: randomUUID(),
    comprobanteId: original.comprobanteId,
    tipo: 'ANULACION',
    total,
  });
  const primera = await notaCrudo(notas, cajero(), cuerpo, { autorizacion: clave.autorizacionId });
  expect(primera.status, JSON.stringify(primera.body)).toBe(201);
  return { original, cuerpo, primera, claveUsada: clave.autorizacionId };
}

describe('ronda 7 · la réplica por id va antes del 403 de clave', () => {
  it('con una autorización YA USADA (la de la primera emisión), la misma huella responde 201 con la nota ya emitida, sin auditoría nueva', async () => {
    const { original, cuerpo, primera, claveUsada } = await notaYaEmitida();
    const usadaAntes = await usadaEn(claveUsada);
    expect(usadaAntes).not.toBeNull();
    const auditoriaAntes = await auditoriaDeLaEmpresa();

    const replica = await notaCrudo(
      notas,
      cajero(),
      { ...cuerpo, motivo: 'Otro motivo' },
      {
        autorizacion: claveUsada,
      },
    );
    expect(replica.status, JSON.stringify(replica.body)).toBe(201);
    expect(replica.body.nota.id).toBe(primera.body.nota.id);
    expect(await usadaEn(claveUsada)).toEqual(usadaAntes);
    expect(await auditoriaDeLaEmpresa()).toBe(auditoriaAntes);
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(1);
  });

  it('con una autorización VENCIDA, la misma huella responde 201 con la nota ya emitida, sin consumir ni auditar nada', async () => {
    const { original, cuerpo, primera } = await notaYaEmitida();
    const vencible = await autorizarNota(
      notas,
      cajero(),
      pinSupervisor(),
      objetivoNota(original.comprobanteId, 'ANULACION', '69.20'),
    );
    // Pasa más tiempo del que dura una autorización (2 minutos): ya no vale para nada.
    await avanzar(ctx, 3 * 60_000, A());
    const auditoriaAntes = await auditoriaDeLaEmpresa();

    const replica = await notaCrudo(
      notas,
      cajero(),
      { ...cuerpo, motivo: 'Otro motivo' },
      {
        autorizacion: vencible.autorizacionId,
      },
    );
    expect(replica.status, JSON.stringify(replica.body)).toBe(201);
    expect(replica.body.nota.id).toBe(primera.body.nota.id);
    expect(await usadaEn(vencible.autorizacionId), 'la vencida quedó sin usar').toBeNull();
    expect(await auditoriaDeLaEmpresa()).toBe(auditoriaAntes);
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(1);
  });

  it.each([
    ['ya usada', 'usada'],
    ['vencida', 'vencida'],
  ])(
    'con otra huella y una autorización %s responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA sin consumir ni auditar nada',
    async (_nombre, cual) => {
      const { original, cuerpo, claveUsada } = await notaYaEmitida();
      let autorizacion = claveUsada;
      if (cual === 'vencida') {
        autorizacion = (
          await autorizarNota(
            notas,
            cajero(),
            pinSupervisor(),
            objetivoNota(original.comprobanteId, 'DEVOLUCION', '28.00'),
          )
        ).autorizacionId;
        await avanzar(ctx, 3 * 60_000, A());
      }
      const usadaAntes = await usadaEn(autorizacion);
      const auditoriaAntes = await auditoriaDeLaEmpresa();
      // El mismo `id` con otra huella: una devolución de ítems en lugar de la anulación.
      const otraHuella = cuerpoNota({
        id: cuerpo.id as string,
        comprobanteId: original.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: 1, cantidad: 1 }],
        devolucion: null,
      });

      const res = await notaCrudo(notas, cajero(), otraHuella, { autorizacion });
      esperarError(res, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
      expect(await usadaEn(autorizacion)).toEqual(usadaAntes);
      expect(await auditoriaDeLaEmpresa()).toBe(auditoriaAntes);
      expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(1);
    },
  );

  it('un id que no existe con una autorización inválida sigue siendo 403 (el 403 de clave significa que el id no existe)', async () => {
    const original = await emitirAceptado(notas, A(), {});
    const res = await notaCrudo(
      notas,
      cajero(),
      cuerpoNota({ comprobanteId: original.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      { autorizacion: randomUUID() },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(0);
  });
});
