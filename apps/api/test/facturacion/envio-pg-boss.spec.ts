// Prueba del desarrollador (no protegida) de punta a punta con pg-boss real (historia 006, T31; criterios 124, 125 y 163):
// un cobro registra el envío, el encolado va a pg-boss con el rol `restaurante_colas` (esquema `colas`), un worker lo
// procesa y el comprobante queda `ACEPTADO`. El trabajo lleva solo `{ empresaId, comprobanteId }`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { ColaPgBoss } from '../../src/nucleo/colas';
import { abrirCliente } from '../utilidades';
import { urlDeRol } from '../utilidades/bd';
import {
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  exigirPse,
  intentosDe,
  turnoDe,
  type AppFact,
  type Escenario,
} from '../facturacion-critica/fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let pgBoss: ColaPgBoss;

const esperarHasta = async (condicion: () => Promise<boolean>, ms = 30_000): Promise<void> => {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('La condición no se cumplió a tiempo');
};

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  await exigirPse(esc);
  pgBoss = new ColaPgBoss(urlDeRol('colas'), { mantenimiento: true });
  // El cobro encola en la cola de la aplicación: aquí esa cola reenvía a pg-boss real.
  vi.spyOn(ctx.cola, 'encolar').mockImplementation((trabajo, opciones) =>
    pgBoss.encolar(trabajo, opciones),
  );
  await pgBoss.trabajar((t) => ctx.procesador.procesar(t.empresaId, t.comprobanteId));
});
afterAll(async () => {
  await pgBoss?.detener();
  await ctx?.cerrar();
  await cerrarAdmin();
});

describe('envío al PSE con pg-boss real', () => {
  it('encola después de confirmar el cobro, el worker procesa y el comprobante queda ACEPTADO', async () => {
    const turnoId = await turnoDe(ctx, esc.A, 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarLomo(ctx, esc.A, { turnoId });
    await esperarHasta(async () => (await comprobanteFila(comprobanteId)).estado === 'ACEPTADO');
    expect(await envioDe(comprobanteId)).toMatchObject({ estado: 'TERMINADO', intentos: 1 });
    expect(await intentosDe(comprobanteId)).toHaveLength(1);
    expect(ctx.pse.llamadas().map((l) => l.operacion)).toEqual(['emitir']);
  });

  it('el trabajo lleva solo empresaId y comprobanteId, y un segundo encolado del mismo comprobante no suma otro', async () => {
    const admin = await abrirCliente('admin');
    try {
      // Se detiene el procesamiento para ver los trabajos en la cola: otra instancia que no trabaja.
      const sola = new ColaPgBoss(urlDeRol('colas'));
      const id = '33333333-3333-3333-3333-333333333333';
      const empresaId = esc.A.id;
      const futuro = new Date(Date.now() + 3_600_000);
      await sola.encolar({ empresaId, comprobanteId: id }, { startAfter: futuro });
      await sola.encolar({ empresaId, comprobanteId: id }, { startAfter: futuro });
      const trabajos = await admin.query(
        `SELECT data, singleton_key FROM colas.job WHERE name = 'envio-pse' AND singleton_key = $1`,
        [id],
      );
      expect(trabajos.rows).toHaveLength(1);
      expect(trabajos.rows[0]?.data).toEqual({ empresaId, comprobanteId: id });
      // Pedir «ya» adelanta el que espera.
      await sola.encolar({ empresaId, comprobanteId: id });
      const adelantado = await admin.query(
        `SELECT start_after FROM colas.job WHERE name = 'envio-pse' AND singleton_key = $1`,
        [id],
      );
      expect(new Date(adelantado.rows[0]?.start_after as string).getTime()).toBeLessThan(
        futuro.getTime(),
      );
      await sola.detener();
    } finally {
      await admin.end();
    }
  });
});

describe('la aplicación con la cola de pg-boss', () => {
  it('arranca pg-boss al iniciar (sin esperar al primer cobro) y lo detiene al cerrar', async () => {
    const cola = new ColaPgBoss(urlDeRol('colas'));
    const app = await crearAplicacion({ colaPse: cola, logger: false });
    const admin = await abrirCliente('admin');
    try {
      const tabla = await admin.query("SELECT to_regclass('colas.job') AS tabla");
      expect(tabla.rows[0]?.tabla).not.toBeNull();
    } finally {
      await admin.end();
      await app.close();
    }
    await expect(
      cola.encolar({ empresaId: esc.A.id, comprobanteId: '44444444-4444-4444-4444-444444444444' }),
    ).rejects.toThrow('detenida');
  });
});
