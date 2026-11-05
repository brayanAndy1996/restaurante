// spec: 006-caja-cobro (pruebas protegidas)
//
// Ataque adversarial, ronda 2 (T25): tres fallas reproducibles convertidas en pruebas, a partir de la especificación
// (criterios 3, 20, 33, 51, 52, 61, 70, 86, 88 y las decisiones del criterio 90 tras la ronda 2).
// - G2 (alta) · criterios 20, 33, 52, 61, 86 y 88 y la decisión del criterio 90: si una anulación (o cualquier cambio
//   permitido) deja una cuenta con cobros sin nada que falte, la orden se cierra en esa misma transacción, sus mesas
//   quedan libres y no se emite otro comprobante; el cierre del turno ya no se bloquea por ella. Una anulación que
//   deja saldo no cierra la orden.
// - G1 (media) · criterios 3, 51 y 70 y la decisión del criterio 90: un cobro que coincide con el cambio de serie de
//   su caja nunca responde SIN_SERIE si la caja tiene una serie activa al confirmar (toma la serie vigente), y la
//   numeración de cada serie queda sin saltos ni duplicados.
// - G3 (media) · criterio 6 y la decisión del criterio 90: el cambio de la tasa de IGV espera a lo sumo unos segundos
//   a los cobros en curso del emisor y, si no puede, responde 409 CONFLICTO en palabras; nunca queda colgado.
//
// Cada falla vive en su propio escenario (empresas nuevas), porque el cierre del último turno de S1 (G2) exige que no
// haya otro turno abierto en la sucursal.
//
// Hoy fallan así: G2 deja la orden ABIERTA con saldo 0.00; G1 responde 409 SIN_SERIE; G3 deja el PUT de la tasa
// esperando hasta que el último cobro termina.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  anularUnidades,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  cobrar,
  cobrarCrudo,
  comprobantesDeLaOrden,
  conteo,
  crearEscenario,
  cuentaC,
  cuentaCon,
  cuentaDe,
  cuentasPorCobrar,
  cuerpoDeCobro,
  enCurso,
  esperar,
  esperarError,
  escribir,
  estadoDeMesa,
  estadoDeOrden,
  exigirEstado,
  filas,
  lineaDe,
  numeracionDeLaCaja,
  ponerSerie,
  ponerTasa,
  Retencion,
  tarjeta,
  versionDe,
  yape,
  api,
  type AppP5,
  type Escenario,
  type Libre,
  type Res,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP5;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 10 });
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

// ------------------------------------------------------------------------------------------------
// G2 · la cuenta con un cobro parcial cuyo resto se anula
// ------------------------------------------------------------------------------------------------
describe('G2 · anular lo que faltaba de una cuenta ya cobrada la cierra y libera la mesa', () => {
  let esc: Escenario;
  let turnoId: string;
  const A = () => esc.A;
  const supervisor = () => A().token.supervisor!;
  const cajero = () => A().token.cajero!;

  beforeAll(async () => {
    esc = await crearEscenario(ctx);
    const cajas = await A().cajas();
    // El único turno abierto de S1 (criterio 33: solo así el cierre se bloquea por las órdenes abiertas).
    turnoId = await abrirTurno(ctx, cajero(), cajas.S1!.caja1, '0.00');
  });

  it('cuenta C: cobro ITEMS de Lomo × 2 y anulación de todo lo demás: la última anulación cierra la orden', async () => {
    const cuenta = await cuentaC(ctx, A(), 'S1');
    const cobro = await cobrar(ctx, cajero(), cuenta, {
      turnoId,
      total: '56.00',
      pagos: [yape('56.00', 'Y-G2-1')],
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 2 }] },
    });
    expect(cobro.comprobante.numero).toMatch(/^B001-\d{8}$/);
    const trasElCobro = await cuentaDe(ctx, cajero(), cuenta.ordenId);
    expect(trasElCobro).toMatchObject({ estado: 'ABIERTA', saldo: '13.20' });

    // Control: las anulaciones que dejan saldo no cierran la orden ni liberan la mesa.
    exigirEstado(
      await anularUnidades(ctx, supervisor(), cuenta.ordenId, cuenta.item.gaseosa!, 1),
      201,
      'Anular la Gaseosa (criterio 86: cambioDeCuentaPermitido lo permite)',
    );
    expect(await cuentaDe(ctx, cajero(), cuenta.ordenId)).toMatchObject({
      estado: 'ABIERTA',
      saldo: '4.20',
    });
    exigirEstado(
      await anularUnidades(ctx, supervisor(), cuenta.ordenId, cuenta.item.bolsa!, 2),
      201,
      'Anular las 2 Bolsas',
    );
    expect(await cuentaDe(ctx, cajero(), cuenta.ordenId)).toMatchObject({
      estado: 'ABIERTA',
      saldo: '3.00',
    });
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    expect(await estadoDeMesa(ctx, supervisor(), cuenta.mesaId)).not.toBe('LIBRE');

    // La última anulación deja la cuenta sin nada que falte (criterio 52): se cierra en esa misma transacción.
    exigirEstado(
      await anularUnidades(ctx, supervisor(), cuenta.ordenId, cuenta.item.mandarina!, 1),
      201,
      'Anular la Mandarina',
    );
    expect(
      await estadoDeOrden(cuenta.ordenId),
      'la orden queda CERRADA en la misma transacción',
    ).toBe('CERRADA');
    expect(await estadoDeMesa(ctx, supervisor(), cuenta.mesaId)).toBe('LIBRE');
    expect(await cuentaDe(ctx, cajero(), cuenta.ordenId)).toMatchObject({
      estado: 'CERRADA',
      saldo: '0.00',
    });
    const porCobrar = await cuentasPorCobrar(ctx, cajero());
    expect(porCobrar.filter((c) => c.ordenId === cuenta.ordenId)).toEqual([]);

    // No se emitió otro comprobante: sigue el de la parte cobrada.
    expect(await comprobantesDeLaOrden(cuenta.ordenId)).toHaveLength(1);
    // Y una orden cerrada ya no se cobra (criterio 61).
    const reintento = await cobrarCrudo(
      ctx,
      cajero(),
      cuenta.ordenId,
      cuerpoDeCobro({
        turnoId,
        version: await versionDe(cuenta.ordenId),
        total: '0.00',
        pagos: [],
      }),
    );
    esperarError(reintento, 409, 'ORDEN_NO_ABIERTA');
  });

  it('variante partes iguales: Gaseosa × 2, se cobra la mitad y se anula la otra gaseosa', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['gaseosa', 2]]);
    await cobrar(ctx, cajero(), cuenta, {
      turnoId,
      total: '9.00',
      formato: 'CONSUMO',
      pagos: [yape('9.00', 'Y-G2-2')],
      parte: { tipo: 'IGUALES', partesRestantes: 2 },
    });
    expect(await cuentaDe(ctx, cajero(), cuenta.ordenId)).toMatchObject({
      estado: 'ABIERTA',
      saldo: '9.00',
    });
    exigirEstado(
      await anularUnidades(ctx, supervisor(), cuenta.ordenId, cuenta.item.gaseosa!, 1),
      201,
      'Anular una Gaseosa de las dos',
    );
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('CERRADA');
    expect(await estadoDeMesa(ctx, supervisor(), cuenta.mesaId)).toBe('LIBRE');
    expect(await cuentaDe(ctx, cajero(), cuenta.ordenId)).toMatchObject({
      estado: 'CERRADA',
      saldo: '0.00',
    });
    expect(
      (await cuentasPorCobrar(ctx, cajero())).filter((c) => c.ordenId === cuenta.ordenId),
    ).toEqual([]);
    expect(await comprobantesDeLaOrden(cuenta.ordenId)).toHaveLength(1);
  });

  it('control: una anulación que deja saldo no cierra la orden, y al cobrar lo que falta se cierra como siempre', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 2],
      ['gaseosa', 1],
    ]);
    await cobrar(ctx, cajero(), cuenta, {
      turnoId,
      total: '28.00',
      pagos: [yape('28.00', 'Y-G2-3')],
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
    });
    exigirEstado(
      await anularUnidades(ctx, supervisor(), cuenta.ordenId, cuenta.item.gaseosa!, 1),
      201,
      'Anular la Gaseosa (queda un Lomo por cobrar)',
    );
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    expect(await estadoDeMesa(ctx, supervisor(), cuenta.mesaId)).not.toBe('LIBRE');
    expect(await cuentaDe(ctx, cajero(), cuenta.ordenId)).toMatchObject({
      estado: 'ABIERTA',
      saldo: '28.00',
    });
    const ultimo = await cobrar(ctx, cajero(), cuenta, {
      turnoId,
      total: '28.00',
      pagos: [yape('28.00', 'Y-G2-4')],
    });
    expect(ultimo.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('CERRADA');
    expect(await estadoDeMesa(ctx, supervisor(), cuenta.mesaId)).toBe('LIBRE');
  });

  it('el cierre del único turno de la sucursal ya no responde CIERRE_BLOQUEADO por esas cuentas', async () => {
    expect(
      await filas(
        "SELECT id, estado FROM orden WHERE sucursal_id = $1 AND estado IN ('ABIERTA','EN_PRECUENTA')",
        [A().S1],
      ),
      'ninguna orden de S1 queda abierta',
    ).toEqual([]);
    // Cobrado en Yape: 56.00 + 9.00 + 28.00 + 28.00; el fondo fue 0.00 y no hubo efectivo.
    const z = await cerrarTurnoCrudo(ctx, cajero(), turnoId, conteo({ YAPE: '121.00' }));
    expect(z.body?.codigo, `Z: ${z.status} ${z.text}`).not.toBe('CIERRE_BLOQUEADO');
    exigirEstado(z, 200, 'Cerrar el único turno de S1 con la Z (criterio 33)');
  });
});

// ------------------------------------------------------------------------------------------------
// G1 · el cobro que coincide con el cambio de serie de su caja
// ------------------------------------------------------------------------------------------------
describe('G1 · un cobro durante el cambio de serie de su caja no responde SIN_SERIE', () => {
  let esc: Escenario;
  let caja2: string;
  let turnoId: string;
  const A = () => esc.A;
  const cajero2 = () => A().token.cajero2!;

  /** Cuentas C nuevas con su versión, listas para cobrarse en una sola petición cada una. */
  const cuentasListas = async (n: number) => {
    const lista: Array<{ ordenId: string; version: number }> = [];
    for (let i = 0; i < n; i++) {
      const c = await cuentaC(ctx, A(), 'S1');
      lista.push({ ordenId: c.ordenId, version: await versionDe(c.ordenId) });
    }
    return lista;
  };
  const cobroTotal = (c: { ordenId: string; version: number }): Promise<Res> =>
    enCurso(
      cobrarCrudo(
        ctx,
        cajero2(),
        c.ordenId,
        cuerpoDeCobro({ turnoId, version: c.version, total: '69.20', pagos: [tarjeta('69.20')] }),
      ),
    );

  beforeAll(async () => {
    esc = await crearEscenario(ctx);
    const cajas = await A().cajas();
    caja2 = cajas.S1!.caja2;
    turnoId = await abrirTurno(ctx, cajero2(), caja2);
  });

  const numeracionSana = async (comprobantesEsperados: number) => {
    const series = await numeracionDeLaCaja(caja2);
    for (const s of series) {
      expect(
        s.consecutivos,
        `la serie ${s.serie} numera sin saltos ni repetidos: ${s.numeros}`,
      ).toBe(true);
    }
    expect(series.reduce((n, s) => n + s.numeros.length, 0)).toBe(comprobantesEsperados);
    return series;
  };

  it('un cobro retenido mientras el PUT cambia B002 por B0Z2: 201 con la serie activa al confirmar', async () => {
    const [cuenta] = await cuentasListas(1);
    // Un administrador de PostgreSQL retiene la auditoría: el PUT de la serie queda entre desactivar B002 y
    // confirmar, y el cobro llega a numerar justo en esa ventana.
    const retencion = await Retencion.deAuditoria();
    let put: Promise<Res>;
    let cobro: Promise<Res>;
    try {
      put = enCurso(ponerSerie(ctx, A().token.admin!, A().S1, caja2, 'BOLETA', 'B0Z2'));
      await esperar(600);
      cobro = cobroTotal(cuenta!);
      await esperar(600);
    } finally {
      await retencion.liberar();
    }
    const [resPut, resCobro] = await Promise.all([put, cobro]);
    exigirEstado(resPut, 200, 'PUT de la serie B0Z2 (criterio 3)');
    expect(
      resCobro.status,
      `el cobro de la caja con serie activa: ${resCobro.status} ${resCobro.body?.codigo} ${resCobro.body?.mensaje}`,
    ).toBe(201);

    const emitido = await comprobantesDeLaOrden(cuenta!.ordenId);
    expect(emitido).toHaveLength(1);
    expect(['B002', 'B0Z2'], 'la serie que estaba activa al confirmar').toContain(
      emitido[0]!.serie,
    );
    expect(resCobro.body.comprobante.numero).toBe(
      `${emitido[0]!.serie}-${String(emitido[0]!.numero).padStart(8, '0')}`,
    );
    const series = await numeracionSana(1);
    expect(series.filter((s) => s.activa).map((s) => s.serie)).toEqual(['B0Z2']);
  });

  it('varios cobros concurrentes con un cambio de serie: todos 201 y numeración sin huecos ni repetidos', async () => {
    const cuentas = await cuentasListas(4);
    const retencion = await Retencion.deAuditoria();
    let put: Promise<Res>;
    let cobros: Array<Promise<Res>>;
    try {
      put = enCurso(ponerSerie(ctx, A().token.admin!, A().S1, caja2, 'BOLETA', 'B0Y2'));
      await esperar(600);
      cobros = cuentas.map(cobroTotal);
      await esperar(600);
    } finally {
      await retencion.liberar();
    }
    const resPut = await put;
    const resCobros = await Promise.all(cobros);
    exigirEstado(resPut, 200, 'PUT de la serie B0Y2 (criterio 3)');
    expect(
      resCobros.map((r) => `${r.status} ${r.body?.codigo ?? ''}`),
      'todos los cobros se emiten',
    ).toEqual(resCobros.map(() => '201 '));

    const series = await numeracionSana(5);
    const emitidos = await filas(
      'SELECT serie, numero FROM comprobante WHERE caja_id = $1 AND orden_id = ANY($2) ORDER BY serie, numero',
      [caja2, cuentas.map((c) => c.ordenId)],
    );
    expect(emitidos).toHaveLength(4);
    expect(
      new Set(emitidos.map((f) => `${f.serie}-${f.numero}`)).size,
      'ningún número repetido',
    ).toBe(4);
    for (const f of emitidos) expect(['B0Z2', 'B0Y2']).toContain(f.serie);
    expect(series.filter((s) => s.activa).map((s) => s.serie)).toEqual(['B0Y2']);
  });

  it('cobros continuos mientras la serie cambia varias veces (B0Y2, B0Z2, B002): todos 201 y sin huecos', async () => {
    const previos = (await numeracionDeLaCaja(caja2)).reduce((n, s) => n + s.numeros.length, 0);
    const cuentas = await cuentasListas(12);
    const cambios = ['B0Z2', 'B002', 'B0Y2'];
    const cobros: Array<Promise<Res>> = [];
    const puts: Array<Promise<Res>> = [];
    for (let i = 0; i < cuentas.length; i++) {
      cobros.push(cobroTotal(cuentas[i]!));
      if (i % 4 === 1) {
        puts.push(
          enCurso(
            ponerSerie(ctx, A().token.admin!, A().S1, caja2, 'BOLETA', cambios[Math.floor(i / 4)]!),
          ),
        );
      }
      await esperar(15);
    }
    const resPuts = await Promise.all(puts);
    const resCobros = await Promise.all(cobros);
    for (const p of resPuts)
      expect([200], `PUT de la serie: ${p.status} ${p.text}`).toContain(p.status);
    expect(
      resCobros.map((r) => `${r.status} ${r.body?.codigo ?? ''}`),
      'todos los cobros se emiten (nunca SIN_SERIE con una serie activa)',
    ).toEqual(resCobros.map(() => '201 '));
    await numeracionSana(previos + 12);
  });
});

// ------------------------------------------------------------------------------------------------
// G3 · el cambio de la tasa de IGV con cobros en curso
// ------------------------------------------------------------------------------------------------
//
// El plazo que la especificación da es «a lo sumo unos segundos» sin cifra: las pruebas exigen que el PUT responda en
// menos de PLAZO_MS desde que se envía, con 200 o con 409 CONFLICTO. Se miden dos situaciones:
//  1. Determinista: un cobro del emisor queda en curso porque un administrador de PostgreSQL retiene la fila de su
//     serie durante RETENCION_MS (mayor que el plazo). Un cambio de tasa que espere «a los cobros en curso» sin límite
//     responde recién al soltarse la retención; con el límite, responde 409 antes. No depende de la velocidad.
//  2. Flujo continuo: ventas de mostrador (cada una es un cobro del emisor) lanzadas sin pausa por 10 trabajadores
//     durante FLUJO_MS, de modo que siempre hay algún cobro del emisor en curso: sin hueco para el cambio. Mide lo
//     mismo con tráfico real; si el cobro se acelerara tanto que el flujo dejara huecos, el PUT puede responder 200
//     enseguida y la prueba sigue siendo válida (solo exige el plazo y la coherencia de la respuesta).
describe('G3 · el cambio de la tasa de IGV no queda colgado esperando a los cobros', () => {
  const PLAZO_MS = 5_000;
  const RETENCION_MS = 9_000;
  const FLUJO_MS = 9_000;
  const FUTURA = '2026-11-10';
  const HOY = '2026-11-02'; // la fecha de Lima del reloj inicial de la API

  let esc: Escenario;
  let turno1: string;
  let turno2: string;
  let cajas: Awaited<ReturnType<Escenario['A']['cajas']>>;
  const A = () => esc.A;

  beforeAll(async () => {
    esc = await crearEscenario(ctx);
    cajas = await A().cajas();
    turno1 = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1);
    turno2 = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
  });

  const tasas = async () =>
    (await api(ctx, A().token.admin!, 'get', `/emisores/${A().emisor1}/tasas-igv`)).body as Libre[];

  /** Lo que el PUT respondió debe ser coherente con la tasa que quedó guardada y con los comprobantes del día. */
  async function verificarCoherencia(res: Res) {
    expect([200, 409], `PUT de la tasa: ${res.status} ${res.text}`).toContain(res.status);
    const guardadas = await tasas();
    if (res.status === 409) {
      esperarError(res, 409, 'CONFLICTO');
      expect(typeof res.body.mensaje).toBe('string');
      expect(res.body.mensaje as string, 'el mensaje está en palabras').toMatch(
        /[a-záéíóúñ]{3,} [a-záéíóúñ]{2,}/i,
      );
      expect(
        guardadas.find((t) => t.desde === FUTURA),
        'el 409 no deja la tasa a medias',
      ).toBeUndefined();
    } else {
      expect(guardadas.find((t) => t.desde === FUTURA)).toMatchObject({ tasa: '18.00' });
    }
    const delDia = await filas(
      'SELECT DISTINCT tasa_igv::text AS tasa FROM comprobante WHERE emisor_id = $1 AND fecha_emision = $2',
      [A().emisor1, HOY],
    );
    expect(
      delDia.map((f) => f.tasa),
      'los comprobantes del día conservan la tasa vigente',
    ).toEqual(['18.00']);
  }

  it('con un cobro del emisor en curso durante más que el plazo, el PUT responde 200 o 409 dentro del plazo', async () => {
    const cuenta = await cuentaC(ctx, A(), 'S1');
    const version = await versionDe(cuenta.ordenId);
    const retencion = await Retencion.deSerieActiva(cajas.S1!.caja1);
    let cobro: Promise<Res>;
    let put: Promise<Res>;
    let respuestaDelPut: { res: Res; ms: number } | undefined;
    const inicio = Date.now();
    try {
      cobro = enCurso(
        cobrarCrudo(
          ctx,
          A().token.cajero!,
          cuenta.ordenId,
          cuerpoDeCobro({ turnoId: turno1, version, total: '69.20', pagos: [tarjeta('69.20')] }),
        ),
      );
      await esperar(1_500); // el cobro ya está en curso: esperando la fila de su serie
      const envio = Date.now();
      put = enCurso(ponerTasa(ctx, A().token.admin!, A().emisor1, FUTURA, '18.00')).then((res) => {
        respuestaDelPut = { res, ms: Date.now() - envio };
        return res;
      });
      // La retención dura más que el plazo: si el PUT sigue esperando, ahora lo ve el reloj.
      while (!respuestaDelPut && Date.now() - inicio < RETENCION_MS) await esperar(100);
    } finally {
      await retencion.liberar();
    }
    const resPut = await put;
    const resCobro = await cobro;
    exigirEstado(resCobro, 201, 'El cobro en curso termina bien al soltarse la retención');
    expect(
      respuestaDelPut!.ms,
      `el PUT de la tasa respondió ${respuestaDelPut!.ms} ms después de enviarse (${resPut.status}); no debe quedar colgado más allá de ${PLAZO_MS} ms`,
    ).toBeLessThan(PLAZO_MS);
    await verificarCoherencia(resPut);
  });

  it('con cobros continuos del emisor (ventas de mostrador sin pausa), el PUT responde 200 o 409 dentro del plazo', async () => {
    // El PUT anterior pudo dejar la tasa futura guardada (200): se pide otra fecha para no repetirse.
    const futura = '2026-11-20';
    const tokens = [
      [A().token.cajero!, turno1],
      [A().token.cajero2!, turno2],
    ] as const;
    let vendidas = 0;
    let detener = false;
    const venta = async (i: number): Promise<Res> => {
      const [token, turnoId] = tokens[i % 2]!;
      return escribir(ctx, token, 'post', '/ventas-mostrador', {
        id: randomUUID(),
        turnoId,
        lineas: [lineaDe(A().carta, 'gaseosa', 1)],
        total: '9.00',
        comprobante: { tipo: 'BOLETA', formato: 'DETALLADO' },
        pagos: [tarjeta('9.00')],
        redondeo: '0.00',
      });
    };
    const trabajador = async (i: number): Promise<number[]> => {
      const estados: number[] = [];
      while (!detener) {
        const r = await enCurso(venta(i));
        estados.push(r.status);
        vendidas++;
      }
      return estados;
    };
    const inicio = Date.now();
    const trabajadores = Array.from({ length: 10 }, (_, i) => trabajador(i));
    await esperar(400);
    const envio = Date.now();
    let ms = -1;
    const put = enCurso(ponerTasa(ctx, A().token.admin!, A().emisor1, futura, '18.00')).then(
      (res) => {
        ms = Date.now() - envio;
        return res;
      },
    );
    // El flujo continúa hasta cumplir FLUJO_MS, haya o no respondido el PUT; después se detiene y se espera todo.
    while (Date.now() - inicio < FLUJO_MS) await esperar(100);
    detener = true;
    const estados = (await Promise.all(trabajadores)).flat();
    const resPut = await put;
    expect(
      ms,
      `el PUT respondió ${ms} ms después de enviarse (${resPut.status}) con ${vendidas} ventas de mostrador en marcha; no debe pasar de ${PLAZO_MS} ms`,
    ).toBeLessThan(PLAZO_MS);
    expect(vendidas, 'hubo cobros durante toda la ventana').toBeGreaterThan(10);
    expect(
      estados.filter((s) => s !== 201),
      'ninguna venta de mostrador falla por el cambio de tasa',
    ).toEqual([]);
    // Numeración intacta en las dos cajas.
    for (const id of [cajas.S1!.caja1, cajas.S1!.caja2]) {
      for (const s of await numeracionDeLaCaja(id))
        expect(s.consecutivos, `serie ${s.serie}`).toBe(true);
    }
    // Coherencia de lo guardado con lo respondido (la fecha pedida aquí es `futura`).
    if (resPut.status === 409) {
      esperarError(resPut, 409, 'CONFLICTO');
      expect(resPut.body.mensaje as string).toMatch(/[a-záéíóúñ]{3,} [a-záéíóúñ]{2,}/i);
      expect((await tasas()).find((t) => t.desde === futura)).toBeUndefined();
    } else {
      expect(resPut.status).toBe(200);
      expect((await tasas()).find((t) => t.desde === futura)).toMatchObject({ tasa: '18.00' });
    }
    const delDia = await filas(
      'SELECT DISTINCT tasa_igv::text AS tasa FROM comprobante WHERE emisor_id = $1 AND fecha_emision = $2',
      [A().emisor1, HOY],
    );
    expect(delDia.map((f) => f.tasa)).toEqual(['18.00']);
  });

  it('sin cobros en curso, el PUT de la tasa responde 200 y guarda la tasa pedida', async () => {
    const res = await ponerTasa(ctx, A().token.admin!, A().emisor1, '2026-12-01', '18.00');
    exigirEstado(res, 200, 'PUT de la tasa sin cobros en curso (criterio 6)');
    expect((await tasas()).find((t) => t.desde === '2026-12-01')).toMatchObject({ tasa: '18.00' });
  });
});
