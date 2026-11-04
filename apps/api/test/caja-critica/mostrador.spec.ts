// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · Venta de mostrador (ruta crítica), criterios 79 a 85:
// - 79 y 80: `POST /ventas-mostrador` cobra primero y envía después, todo o nada: crea la orden MOSTRADOR (canal SALON, sin
//   mesa, 1 comensal), valida las líneas con el envío de 004, emite el comprobante como un cobro TOTAL, deja la orden
//   CERRADA y solo entonces quedan las comandas por estación; si algo falla, no queda nada (ni orden, ni comanda, ni
//   comprobante, ni número de llamado, ni trabajo de impresión, ni número de serie consumido);
// - 81: número de llamado correlativo por sucursal y día operativo, sin saltos ni repetidos con ventas concurrentes, que
//   se reinicia con la hora de corte (05:00 por defecto);
// - 82: la comanda y el KDS llevan el número de llamado en lugar de la mesa, y el comprobante también;
// - 83: réplicas por clave y por `id`; diez concurrentes dejan una sola venta; 84: precio que cambió; 85: sin descuentos.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  conteo,
  crearEscenario,
  efectivo,
  escribir,
  esperarError,
  exigirEstado,
  filas,
  lineaDe,
  sesionContrasena,
  ultimoNumero,
  yape,
  type AppP5,
  type Escenario,
  type Libre,
  type NombreLinea,
  type Res,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;
let tokenCajero: string;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
  tokenCajero = A().token.cajero!;
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

let turnoCajero: Promise<string> | undefined;
const turno = () =>
  (turnoCajero ??= (async () => abrirTurno(ctx, tokenCajero, (await A().cajas()).S1!.caja1))());

/** Lomo [3/4] × 2, Gaseosa, Bolsa × 2, Mandarina y un Pisco sour (la cuenta C más 12.00 en la Barra): `"81.20"`. */
const LINEAS: Array<[NombreLinea, number]> = [
  ['lomo', 2],
  ['gaseosa', 1],
  ['bolsa', 2],
  ['mandarina', 1],
  ['pisco', 1],
];

function cuerpoVenta(turnoId: string, o: Libre = {}): Libre {
  return {
    id: randomUUID(),
    turnoId,
    lineas: (o.lineas ?? LINEAS).map(([n, q]: [NombreLinea, number]) => lineaDe(A().carta, n, q)),
    total: '81.20',
    comprobante: { tipo: 'BOLETA', formato: 'DETALLADO' },
    pagos: [efectivo('81.20', '100.00')],
    redondeo: '0.00',
    ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'lineas')),
  };
}

const vender = (cuerpo: Libre, token = tokenCajero, clave?: string): Promise<Res> =>
  escribir(
    ctx,
    token,
    'post',
    '/ventas-mostrador',
    cuerpo,
    clave ? { 'Idempotency-Key': clave } : {},
  );

/** Lo que dejan las ventas en la sucursal S1: para comprobar que una venta rechazada no dejó nada. */
async function huella() {
  const s = A().S1;
  const n = async (sql: string) => Number((await filas(sql, [s]))[0]!.n);
  return {
    ordenes: await n(
      `SELECT count(*) AS n FROM orden WHERE sucursal_id = $1 AND tipo = 'MOSTRADOR'`,
    ),
    comandas: await n('SELECT count(*) AS n FROM comanda WHERE sucursal_id = $1'),
    comprobantes: await n('SELECT count(*) AS n FROM comprobante WHERE sucursal_id = $1'),
    trabajos: await n('SELECT count(*) AS n FROM trabajo_impresion WHERE sucursal_id = $1'),
    llamado: await n(
      'SELECT coalesce(max(ultimo), 0) AS n FROM contador_llamado WHERE sucursal_id = $1',
    ),
    serie: await ultimoNumero((await A().cajas()).S1!.caja1, 'BOLETA'),
  };
}

describe('criterios 79 a 82 · vender', () => {
  it('cobra y envía en una transacción: orden MOSTRADOR cerrada, comandas por estación y número de llamado 1', async () => {
    const turnoId = await turno();
    const res = await vender(cuerpoVenta(turnoId));
    exigirEstado(res, 201, 'Vender en el mostrador (006, criterio 79)');
    const { venta, cobro, envio } = res.body;
    expect(venta.numeroLlamado).toBe(1);
    expect(venta.id).toBe(venta.ordenId);
    expect(cobro).toMatchObject({
      ordenId: venta.ordenId,
      total: '81.20',
      vuelto: '18.80',
      cuenta: { estado: 'CERRADA', saldo: '0.00' },
    });
    expect(cobro.comprobante).toMatchObject({
      tipo: 'BOLETA',
      estado: 'POR_ENVIAR',
      orden: { id: venta.ordenId, mesas: [], mozo: null, numeroLlamado: 1 },
    });
    // El envío de 004: una comanda por estación con ruteo (Cocina por el Lomo, Barra por el Pisco sour).
    expect(envio.comandas.map((c: Libre) => c.estacionNombre).sort()).toEqual(['Barra', 'Cocina']);
    expect(envio.items).toHaveLength(5);
    const [orden] = await filas('SELECT tipo, canal, estado, comensales FROM orden WHERE id = $1', [
      venta.ordenId,
    ]);
    expect(orden).toMatchObject({
      tipo: 'MOSTRADOR',
      canal: 'SALON',
      estado: 'CERRADA',
      comensales: 1,
    });
    expect(await filas('SELECT 1 FROM orden_mesa WHERE orden_id = $1', [venta.ordenId])).toEqual(
      [],
    );
    const [guardado] = await filas(
      'SELECT mesas, mozo_nombre, numero_llamado FROM comprobante WHERE id = $1',
      [cobro.comprobante.id],
    );
    expect(guardado).toEqual({ mesas: [], mozo_nombre: null, numero_llamado: 1 });
    // El puerto de inventario se llamó como en cualquier envío.
    expect(ctx.inventario.alEnviarLlamadas().length).toBeGreaterThan(0);
  });

  it('la comanda de cada estación y el KDS llevan el número de llamado en lugar de la mesa', async () => {
    const turnoId = await turno();
    const res = await vender(cuerpoVenta(turnoId));
    exigirEstado(res, 201, 'Vender en el mostrador');
    const { venta } = res.body;
    const kds = await api(ctx, A().token.cocina!, 'get', '/cocina/comandas');
    exigirEstado(kds, 200, 'GET /cocina/comandas (004)');
    const comandas = [...kds.body.pendientes, ...kds.body.recientes].filter(
      (c: Libre) => c.orden.id === venta.ordenId,
    );
    expect(comandas).toHaveLength(2);
    for (const c of comandas) {
      expect(c.orden.numeroLlamado).toBe(venta.numeroLlamado);
      expect(c.orden.mesas).toEqual([]);
      expect(c.orden.mozo).toBeNull();
    }
  });

  it('Mozo y Cocina/Barra reciben 403 PROHIBIDO y no queda nada', async () => {
    const antes = await huella();
    for (const token of [A().token.mozo!, A().token.cocina!]) {
      esperarError(await vender(cuerpoVenta(await turno()), token), 403, 'PROHIBIDO');
    }
    expect(await huella()).toEqual(antes);
  });
});

describe('criterio 80 · todo o nada', () => {
  it('una línea agotada responde 422 y no queda orden, comanda, comprobante, número de llamado ni trabajo', async () => {
    const turnoId = await turno();
    const agotado = await api(
      ctx,
      A().token.supervisor!,
      'put',
      `/carta/sucursal/agotados/${A().carta.gaseosa}`,
      {
        hasta: 'FIN_DEL_DIA',
      },
    );
    exigirEstado(agotado, 200, 'Marcar la Gaseosa agotada (003)');
    try {
      const antes = await huella();
      const res = await vender(cuerpoVenta(turnoId));
      expect(res.status, res.text).toBe(422);
      expect(res.body.codigo).toBe('PRODUCTO_NO_VENDIBLE');
      expect(await huella()).toEqual(antes);
    } finally {
      const r = await api(
        ctx,
        A().token.supervisor!,
        'delete',
        `/carta/sucursal/agotados/${A().carta.gaseosa}`,
      );
      expect(r.status).toBe(204);
    }
  });

  it('un pago que no cuadra responde 422 PAGOS_NO_CUADRAN y se revierte también el envío', async () => {
    const turnoId = await turno();
    const antes = await huella();
    const res = await vender(cuerpoVenta(turnoId, { pagos: [efectivo('81.19')] }));
    esperarError(res, 422, 'PAGOS_NO_CUADRAN');
    expect(await huella()).toEqual(antes);
  });

  it('un turno cerrado responde 409 TURNO_CERRADO y no queda nada', async () => {
    const cajas = await A().cajas();
    await turno(); // el turno del Cajero sigue abierto: el del Cajero 2 se puede cerrar
    const t2 = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
    exigirEstado(
      await cerrarTurnoCrudo(ctx, A().token.cajero2!, t2, conteo({ EFECTIVO: '200.00' })),
      200,
      'Cerrar el turno del Cajero 2',
    );
    const antes = await huella();
    esperarError(await vender(cuerpoVenta(t2), A().token.cajero2!), 409, 'TURNO_CERRADO');
    expect(await huella()).toEqual(antes);
  });

  it('una venta rechazada no consume número de llamado ni de serie: la siguiente usa el siguiente', async () => {
    const turnoId = await turno();
    const antes = await huella();
    const mala = await vender(cuerpoVenta(turnoId, { pagos: [efectivo('1.00')] }));
    expect(mala.status).toBe(422);
    const buena = await vender(cuerpoVenta(turnoId));
    exigirEstado(buena, 201, 'Vender');
    expect(buena.body.venta.numeroLlamado).toBe(antes.llamado + 1);
    expect(await ultimoNumero((await A().cajas()).S1!.caja1, 'BOLETA')).toBe(antes.serie + 1);
  });
});

describe('criterio 81 · número de llamado', () => {
  it('ventas concurrentes reciben números consecutivos sin saltos ni repetidos', async () => {
    const turnoId = await turno();
    const antes = (await huella()).llamado;
    const respuestas = await Promise.all(
      Array.from({ length: 8 }, () => vender(cuerpoVenta(turnoId))),
    );
    for (const r of respuestas) exigirEstado(r, 201, 'Venta concurrente');
    const numeros = respuestas
      .map((r) => r.body.venta.numeroLlamado as number)
      .sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: 8 }, (_, i) => antes + 1 + i));
  });

  it('se reinicia con la hora de corte del día operativo (05:00): a las 04:59 sigue, a las 05:00 vuelve a 1', async () => {
    const turnoId = await turno();
    const antes = (await huella()).llamado;
    expect(antes).toBeGreaterThan(0);
    ctx.reloj.fijar('2026-11-03T04:59:00-05:00');
    const token = await sesionContrasena(ctx, A().personas.cajero!, A().S1);
    const tarde = await vender(cuerpoVenta(turnoId), token);
    exigirEstado(tarde, 201, 'Venta de madrugada');
    expect(tarde.body.venta.numeroLlamado).toBe(antes + 1);
    ctx.reloj.fijar('2026-11-03T05:00:00-05:00');
    const token2 = await sesionContrasena(ctx, A().personas.cajero!, A().S1);
    const nuevo = await vender(cuerpoVenta(turnoId), token2);
    exigirEstado(nuevo, 201, 'Venta del día operativo nuevo');
    expect(nuevo.body.venta.numeroLlamado).toBe(1);
    tokenCajero = token2;
  });
});

describe('criterio 83 · réplicas', () => {
  it('la misma clave devuelve la misma venta; el mismo id con otra clave, también, sin otra orden ni número', async () => {
    const turnoId = await turno();
    const cuerpo = cuerpoVenta(turnoId);
    const clave = randomUUID();
    const primera = await vender(cuerpo, tokenCajero, clave);
    exigirEstado(primera, 201, 'Vender');
    const antes = await huella();
    const misma = await vender(cuerpo, tokenCajero, clave);
    expect(misma.status, misma.text).toBe(201);
    expect(misma.body).toEqual(primera.body);
    const otraClave = await vender(cuerpo, tokenCajero);
    expect(otraClave.status, otraClave.text).toBe(201);
    expect(otraClave.body.venta).toEqual(primera.body.venta);
    expect(await huella()).toEqual(antes);
  });

  it('el mismo id con otras líneas o pagos responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const turnoId = await turno();
    const cuerpo = cuerpoVenta(turnoId);
    exigirEstado(await vender(cuerpo), 201, 'Vender');
    const otrasLineas = cuerpoVenta(turnoId, {
      id: cuerpo.id,
      lineas: [['lomo', 1]],
      total: '28.00',
      pagos: [efectivo('28.00')],
    });
    esperarError(await vender(otrasLineas), 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    const otrosPagos = { ...cuerpo, pagos: [yape('81.20')] };
    esperarError(await vender(otrosPagos), 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
  });

  it('diez peticiones concurrentes con el mismo id dejan una sola venta', async () => {
    const turnoId = await turno();
    const cuerpo = cuerpoVenta(turnoId);
    const antes = await huella();
    const respuestas = await Promise.all(Array.from({ length: 10 }, () => vender(cuerpo)));
    for (const r of respuestas) {
      expect([201, 409], `${r.status} ${r.text}`).toContain(r.status);
      if (r.status === 409) expect(r.body.codigo).toBe('CONFLICTO');
    }
    const ok = respuestas.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThan(0);
    for (const r of ok) expect(r.body).toEqual(ok[0]!.body);
    const despues = await huella();
    expect(despues.ordenes).toBe(antes.ordenes + 1);
    expect(despues.comprobantes).toBe(antes.comprobantes + 1);
    expect(despues.llamado).toBe(antes.llamado + 1);
    expect(despues.serie).toBe(antes.serie + 1);
  });
});

describe('criterios 84 y 85 · precio que cambió y sin descuentos', () => {
  it('un total distinto del calculado con la carta vigente responde 409 CUENTA_CAMBIO con el total nuevo y no guarda nada', async () => {
    const turnoId = await turno();
    const antes = await huella();
    const res = await vender(cuerpoVenta(turnoId, { total: '81.00', pagos: [efectivo('81.00')] }));
    esperarError(res, 409, 'CUENTA_CAMBIO');
    const campos = res.body.campos as Array<{ campo: string; mensaje: string }>;
    expect(campos.some((c) => c.campo === 'total' && c.mensaje.includes('81.20'))).toBe(true);
    expect(await huella()).toEqual(antes);
  });

  it('la venta de mostrador no admite descuentos ni cortesías: el campo es 400 DATOS_INVALIDOS', async () => {
    const turnoId = await turno();
    const antes = await huella();
    for (const extra of [{ descuento: { tipo: 'MONTO', valor: '5.00' } }, { cortesias: [] }]) {
      const res = await vender({ ...cuerpoVenta(turnoId), ...extra });
      esperarError(res, 400, 'DATOS_INVALIDOS');
    }
    expect(await huella()).toEqual(antes);
  });
});
