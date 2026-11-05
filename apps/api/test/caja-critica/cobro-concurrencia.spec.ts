// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · Concurrencia del cobro (ruta crítica), criterios 57 a 59:
// - 57: dos cajeros cobrando a la vez la misma cuenta con la misma `version`: exactamente uno responde 201; el otro,
//   409 CUENTA_CAMBIO (o ORDEN_NO_ABIERTA si el primero la cerró); nunca dos comprobantes por la misma parte;
// - 58: un envío (o una anulación) y un cobro TOTAL a la vez: o el cobro responde 409 CUENTA_CAMBIO, o la orden queda
//   CERRADA y el envío responde 409 ORDEN_NO_ABIERTA; nunca queda un ítem enviado sin cobrar en una orden cerrada;
// - 59: un cobro y el cierre del mismo turno a la vez: o el cobro entra en la Z o responde 409 TURNO_CERRADO; nunca
//   queda un cobro de un turno cerrado fuera de su Z.
// Cada situación se repite varias veces para recorrer distintos órdenes de llegada.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  cobrarCrudo,
  cobrosDeLaOrden,
  comprobantesDeLaOrden,
  conteo,
  crearEscenario,
  cuentaC,
  cuerpoDeCobro,
  enviarLineas,
  escribir,
  estadoDeOrden,
  exigirEstado,
  filas,
  versionDe,
  type AppP5,
  type Escenario,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

let turnoCajero: Promise<string> | undefined;
const turnoUno = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());
let turnoCajero2: Promise<string> | undefined;
const turnoDos = () =>
  (turnoCajero2 ??= (async () =>
    abrirTurno(ctx, A().token.cajero2!, (await A().cajas()).S1!.caja2))());

const REPETICIONES = 4;

describe('criterio 57 · dos cajeros a la vez', () => {
  it('con la misma cuenta y la misma versión, exactamente uno cobra y nunca hay dos comprobantes por la misma parte', async () => {
    const t1 = await turnoUno();
    const t2 = await turnoDos();
    for (let i = 0; i < REPETICIONES; i++) {
      const cuenta = await cuentaC(ctx, A());
      const version = await versionDe(cuenta.ordenId);
      const [r1, r2] = await Promise.all([
        cobrarCrudo(
          ctx,
          A().token.cajero!,
          cuenta.ordenId,
          cuerpoDeCobro({ turnoId: t1, version, total: '69.20' }),
        ),
        cobrarCrudo(
          ctx,
          A().token.cajero2!,
          cuenta.ordenId,
          cuerpoDeCobro({ turnoId: t2, version, total: '69.20' }),
        ),
      ]);
      const estados = [r1, r2].map((r) => r.status).sort();
      expect(estados, `${r1.text} | ${r2.text}`).toEqual([201, 409]);
      const perdedor = r1.status === 409 ? r1 : r2;
      expect(['CUENTA_CAMBIO', 'ORDEN_NO_ABIERTA']).toContain(perdedor.body.codigo);
      expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
      expect(await comprobantesDeLaOrden(cuenta.ordenId)).toHaveLength(1);
    }
  });

  it('dos partes por ítems iguales a la vez: una cobra y la otra responde 409 CUENTA_CAMBIO', async () => {
    const t1 = await turnoUno();
    const t2 = await turnoDos();
    const cuenta = await cuentaC(ctx, A());
    const version = await versionDe(cuenta.ordenId);
    const parte = { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] };
    const [r1, r2] = await Promise.all([
      cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId: t1, version, total: '28.00', parte }),
      ),
      cobrarCrudo(
        ctx,
        A().token.cajero2!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId: t2, version, total: '28.00', parte }),
      ),
    ]);
    expect([r1.status, r2.status].sort(), `${r1.text} | ${r2.text}`).toEqual([201, 409]);
    expect((r1.status === 409 ? r1 : r2).body.codigo).toBe('CUENTA_CAMBIO');
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
  });
});

describe('criterio 58 · el mozo agrega o anula mientras se cobra', () => {
  /** Ningún ítem vigente de una orden cerrada queda sin facturar. */
  async function sinItemsSinCobrar(ordenId: string): Promise<void> {
    const sueltos = await filas(
      'SELECT id FROM item WHERE orden_id = $1 AND cantidad - cantidad_anulada > cantidad_facturada',
      [ordenId],
    );
    expect(sueltos, 'ítems enviados sin cobrar en una orden cerrada').toEqual([]);
  }

  it('un envío y un cobro TOTAL a la vez: el cobro falla por la cuenta nueva o la orden se cierra y el envío falla', async () => {
    const turnoId = await turnoUno();
    for (let i = 0; i < REPETICIONES; i++) {
      const cuenta = await cuentaC(ctx, A());
      const version = await versionDe(cuenta.ordenId);
      const [envio, cobro] = await Promise.all([
        enviarLineas(ctx, A(), cuenta, [['gaseosa', 1]]),
        cobrarCrudo(
          ctx,
          A().token.cajero!,
          cuenta.ordenId,
          cuerpoDeCobro({ turnoId, version, total: '69.20' }),
        ),
      ]);
      if (cobro.status === 201) {
        expect(envio.status, envio.text).toBe(409);
        expect(envio.body.codigo).toBe('ORDEN_NO_ABIERTA');
        expect(await estadoDeOrden(cuenta.ordenId)).toBe('CERRADA');
        await sinItemsSinCobrar(cuenta.ordenId);
      } else {
        expect(cobro.status, cobro.text).toBe(409);
        expect(cobro.body.codigo).toBe('CUENTA_CAMBIO');
        expect(envio.status, envio.text).toBe(201);
        expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
        expect(await cobrosDeLaOrden(cuenta.ordenId)).toEqual([]);
      }
    }
  });

  it('una anulación y un cobro TOTAL a la vez: igual, nunca una anulación sobre una orden ya cobrada', async () => {
    const turnoId = await turnoUno();
    for (let i = 0; i < REPETICIONES; i++) {
      const cuenta = await cuentaC(ctx, A());
      const version = await versionDe(cuenta.ordenId);
      const [anulacion, cobro] = await Promise.all([
        escribir(
          ctx,
          A().token.supervisor!,
          'post',
          `/ordenes/${cuenta.ordenId}/items/${cuenta.item.gaseosa}/anulaciones`,
          {
            id: randomUUID(),
            cantidad: 1,
            motivo: 'Se cayó la gaseosa',
            destinoStock: 'MERMA',
          },
        ),
        cobrarCrudo(
          ctx,
          A().token.cajero!,
          cuenta.ordenId,
          cuerpoDeCobro({ turnoId, version, total: '69.20' }),
        ),
      ]);
      if (cobro.status === 201) {
        expect(anulacion.status, anulacion.text).toBe(409);
        expect(anulacion.body.codigo).toBe('ORDEN_NO_ABIERTA');
        expect(await estadoDeOrden(cuenta.ordenId)).toBe('CERRADA');
        await sinItemsSinCobrar(cuenta.ordenId);
      } else {
        expect(cobro.status, cobro.text).toBe(409);
        expect(cobro.body.codigo).toBe('CUENTA_CAMBIO');
        expect(anulacion.status, anulacion.text).toBe(201);
      }
    }
  });
});

describe('criterio 59 · el turno se cierra a la vez', () => {
  it('un cobro y el cierre del mismo turno: el cobro entra en la Z o responde 409 TURNO_CERRADO', async () => {
    // Los turnos del Cajero y del Cajero 2 siguen abiertos (criterio 26: uno por persona y por caja); este criterio
    // abre y cierra los suyos con el Supervisor en la Caja 3, que ninguna otra prueba de este archivo usa.
    await turnoUno();
    const motivos = {
      EFECTIVO: 'x',
      TARJETA_CREDITO: 'x',
      TARJETA_DEBITO: 'x',
      YAPE: 'x',
      PLIN: 'x',
    };
    for (let i = 0; i < REPETICIONES; i++) {
      const turnoId = await abrirTurno(
        ctx,
        A().token.supervisor!,
        (await A().cajas()).S1!.caja3,
        '100.00',
      );
      const cuenta = await cuentaC(ctx, A());
      const version = await versionDe(cuenta.ordenId);
      const [cobro, cierre] = await Promise.all([
        cobrarCrudo(
          ctx,
          A().token.supervisor!,
          cuenta.ordenId,
          cuerpoDeCobro({ turnoId, version, total: '69.20' }),
        ),
        cerrarTurnoCrudo(
          ctx,
          A().token.supervisor!,
          turnoId,
          conteo({ EFECTIVO: '100.00' }, motivos),
        ),
      ]);
      exigirEstado(cierre, 200, `Cerrar el turno ${i}`);
      const [z] = await filas(
        `SELECT esperado FROM turno_conteo WHERE turno_id = $1 AND medio = 'EFECTIVO'`,
        [turnoId],
      );
      if (cobro.status === 201) {
        // El cobro terminó antes: está en la Z (fondo 100.00 + 69.20 en efectivo).
        expect(z!.esperado).toBe('169.20');
        expect(await cobrosDeLaOrden(cuenta.ordenId)).toHaveLength(1);
      } else {
        expect(cobro.status, cobro.text).toBe(409);
        expect(cobro.body.codigo).toBe('TURNO_CERRADO');
        expect(z!.esperado).toBe('100.00');
        expect(await cobrosDeLaOrden(cuenta.ordenId)).toEqual([]);
      }
      // Nunca un cobro de un turno cerrado fuera de su Z.
      const fuera = await filas('SELECT 1 FROM cobro WHERE turno_id = $1', [turnoId]);
      expect(fuera.length).toBe(cobro.status === 201 ? 1 : 0);
      void api;
    }
  });
});
