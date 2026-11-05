// Historia 006 · caja, cobro y comprobantes · prueba del desarrollador (no protegida) del criterio 45a: `restarMontos`
// de `packages/dominio` lanza `RangeError` con un saldo negativo (el dato malo se detecta), pero ninguna ruta de la API
// responde 500 por eso. Se fuerza el dato malo por SQL como administrador (más cobrado en la orden que su cuenta) y se
// comprueba la cuenta, la lista de cuentas, la pre-cuenta y el cobro; este último se revierte entero.
import { randomUUID } from 'node:crypto';
import { conActor } from '../aislamiento/fabrica';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cobrarCrudo,
  contar,
  crearEscenario,
  cuentaC,
  cuerpoDeCobro,
  escribir,
  esperarError,
  exigirEstado,
  filas,
  admin,
  versionDe,
  type AppP5,
  type Escenario,
} from '../caja-critica/fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

/**
 * Corre `hacer` con la orden cobrada de más (`monto_cobrado` pasa de su cuenta). El administrador escribe en una
 * transacción con el actor de pruebas (la trazabilidad lo exige) que se confirma para que la API vea el dato malo; al
 * terminar, otra transacción deja los valores de antes.
 */
async function conSaldoNegativo(
  ordenId: string,
  opciones: { cobros: number },
  hacer: () => Promise<void>,
): Promise<void> {
  const c = await admin();
  const [antes] = await filas<{ monto_cobrado: string; icbper_cobrado: string; cobros: number }>(
    'SELECT monto_cobrado::text AS monto_cobrado, icbper_cobrado::text AS icbper_cobrado, cobros FROM orden WHERE id = $1',
    [ordenId],
  );
  await conActor(c, () =>
    c.query('UPDATE orden SET monto_cobrado = 999999.00, cobros = $2 WHERE id = $1', [
      ordenId,
      opciones.cobros,
    ]),
  );
  try {
    await hacer();
  } finally {
    await conActor(c, () =>
      c.query(
        'UPDATE orden SET monto_cobrado = $2::numeric, icbper_cobrado = $3::numeric, cobros = $4 WHERE id = $1',
        [ordenId, antes!.monto_cobrado, antes!.icbper_cobrado, antes!.cobros],
      ),
    );
  }
}

describe('un saldo negativo nunca responde 500 (criterio 45a)', () => {
  it('GET /cuentas/:ordenId y GET /cuentas: 409 CONFLICTO, y vuelven a leerse cuando el dato se arregla', async () => {
    const cuenta = await cuentaC(ctx, A());
    await conSaldoNegativo(cuenta.ordenId, { cobros: 1 }, async () => {
      esperarError(
        await api(ctx, A().token.mozo, 'get', `/cuentas/${cuenta.ordenId}`),
        409,
        'CONFLICTO',
      );
      esperarError(await api(ctx, A().token.cajero!, 'get', '/cuentas'), 409, 'CONFLICTO');
    });
    exigirEstado(
      await api(ctx, A().token.mozo, 'get', `/cuentas/${cuenta.ordenId}`),
      200,
      'La cuenta ya arreglada',
    );
  });

  it('POST /ordenes/:id/precuentas: 409 CONFLICTO, sin guardar la pre-cuenta', async () => {
    const cuenta = await cuentaC(ctx, A());
    await conSaldoNegativo(cuenta.ordenId, { cobros: 1 }, async () => {
      const res = await escribir(
        ctx,
        cuenta.token,
        'post',
        `/ordenes/${cuenta.ordenId}/precuentas`,
        {
          id: randomUUID(),
        },
      );
      esperarError(res, 409, 'CONFLICTO');
    });
    expect(await contar('SELECT 1 FROM precuenta WHERE orden_id = $1', [cuenta.ordenId])).toBe(0);
  });

  it('POST /cuentas/:ordenId/cobros: 409 CUENTA_CAMBIO y no deja número, comprobante ni cobro', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1);
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '37.00',
      parte: {
        tipo: 'ITEMS',
        items: [
          { itemId: cuenta.item.lomo!, cantidad: 1 },
          { itemId: cuenta.item.gaseosa!, cantidad: 1 },
        ],
      },
    });
    await conSaldoNegativo(cuenta.ordenId, { cobros: 0 }, async () => {
      const res = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo);
      esperarError(res, 409, 'CUENTA_CAMBIO');
    });
    expect(await contar('SELECT 1 FROM cobro WHERE id = $1', [cuerpo.id])).toBe(0);
    expect(await contar('SELECT 1 FROM comprobante WHERE cobro_id = $1', [cuerpo.id])).toBe(0);
    // Con el dato arreglado el mismo cobro entra: no se consumió ningún número.
    exigirEstado(
      await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo),
      201,
      'El cobro con el dato arreglado',
    );
  });
});
