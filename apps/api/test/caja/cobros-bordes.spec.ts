// Historia 006 · caja, cobro y comprobantes, grupo C4 (T15) · pruebas del desarrollador (no protegidas) de los bordes del
// cobro que las protegidas no recorren: ningún `RangeError` del dominio termina en 500, la réplica por `id` no sale de
// la sucursal, la cuenta lista sus cobros y unir una orden con cobros se rechaza también con una mesa libre.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cobrar,
  cobrarCrudo,
  crearEscenario,
  cuentaC,
  cuerpoDeCobro,
  efectivo,
  escribir,
  esperarError,
  exigirEstado,
  versionDe,
  yape,
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

let turnoCajero: Promise<string> | undefined;
const turno = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());

describe('entradas que el dominio rechazaría con RangeError', () => {
  it('un recibido en un medio que no es efectivo, un redondeo enorme y montos con ceros a la izquierda no dan 500', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const version = await versionDe(cuenta.ordenId);
    const casos = [
      {
        que: 'recibido en Yape',
        pagos: [{ ...yape('69.20'), recibido: '70.00' }],
        redondeo: '0.00',
      },
      { que: 'redondeo de 8 enteros', pagos: [efectivo('69.20')], redondeo: '99999999.99' },
      { que: 'dos efectivos', pagos: [efectivo('30.00'), efectivo('39.20')], redondeo: '0.00' },
    ];
    for (const c of casos) {
      const res = await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version, total: '69.20', pagos: c.pagos, redondeo: c.redondeo }),
      );
      expect(res.status, `${c.que}: ${res.text}`).toBe(422);
      expect(res.body.codigo, c.que).toBe('PAGOS_NO_CUADRAN');
    }
    // El total y los pagos con ceros a la izquierda o sin decimales se normalizan a 2 decimales.
    const ok = await cobrarCrudo(
      ctx,
      A().token.cajero!,
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version,
        total: '069.2',
        pagos: [{ medio: 'EFECTIVO', monto: '69.2', recibido: '100' }],
      }),
    );
    exigirEstado(ok, 201, 'Cobrar con montos sin normalizar');
    expect(ok.body).toMatchObject({ total: '69.20', vuelto: '30.80' });
  });
});

describe('réplica por id', () => {
  it('desde otra sucursal de la empresa no devuelve el cobro: 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    exigirEstado(await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo), 201, 'Cobrar');
    const ajena = await cobrarCrudo(ctx, A().token.supervisorS3!, cuenta.ordenId, cuerpo);
    esperarError(ajena, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  });
});

describe('réplica por id y dueño del turno (M11)', () => {
  it('otro Cajero que repite el id de un cobro ajeno recibe 409 TURNO_AJENO, no la respuesta guardada; el Supervisor sí la recibe', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '69.20',
    });
    const hecho = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo);
    exigirEstado(hecho, 201, 'Cobrar');
    esperarError(
      await cobrarCrudo(ctx, A().token.cajero2!, cuenta.ordenId, cuerpo),
      409,
      'TURNO_AJENO',
    );
    const delSupervisor = await cobrarCrudo(ctx, A().token.supervisor!, cuenta.ordenId, cuerpo);
    exigirEstado(delSupervisor, 201, 'Réplica del Supervisor');
    expect(delSupervisor.body).toEqual(hecho.body);
  });
});

describe('la cuenta con cobros', () => {
  it('GET /cuentas/:ordenId lista los cobros en el orden de sus partes, con el comprobante y quién cobró', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno();
    const p1 = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '37.00',
      parte: {
        tipo: 'ITEMS',
        items: [
          { itemId: cuenta.item.lomo!, cantidad: 1 },
          { itemId: cuenta.item.gaseosa!, cantidad: 1 },
        ],
      },
    });
    const p2 = await cobrar(ctx, A().token.cajero!, cuenta, { turnoId, total: '32.20' });
    const res = await api(ctx, A().token.mozo, 'get', `/cuentas/${cuenta.ordenId}`);
    exigirEstado(res, 200, 'GET /cuentas/:ordenId');
    expect(res.body.cobros.map((c: { id: string }) => c.id)).toEqual([p1.id, p2.id]);
    expect(res.body.cobros[0]).toMatchObject({
      total: '37.00',
      comprobante: { id: p1.comprobante.id, tipo: 'BOLETA', numero: p1.comprobante.numero },
      cobradoPor: { id: A().personas.cajero!.id },
    });
    expect(res.body).toMatchObject({ estado: 'CERRADA', cobrado: '69.20', saldo: '0.00' });
  });
});

describe('unir con cobros', () => {
  it('la principal con cobros rechaza unir también una mesa libre: 409 CUENTA_EN_COBRO', async () => {
    const cuenta = await cuentaC(ctx, A());
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno(),
      total: '28.00',
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
    });
    const libre = await A().mesaNueva('S1');
    const res = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/ordenes/${cuenta.ordenId}/union`,
      { mesaIds: [libre] },
    );
    esperarError(res, 409, 'CUENTA_EN_COBRO');
  });
});
