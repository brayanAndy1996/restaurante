// spec: 006-caja-cobro (pruebas protegidas)
//
// P2 · División de la cuenta (ruta crítica), criterios 64 a 68:
// - 64: por ítems con el ejemplo de la cuenta C (parte 1 = 1 Lomo + 1 Gaseosa por 37.00; parte 2 = TOTAL por 32.20);
// - 65: en partes iguales con el ejemplo de la cuenta C en 2 partes (34.60 y 34.60) y su desglose por consumo;
// - 66: el orden de los modos (primero ítems, después iguales; nunca al revés; TOTAL solo sin partes iguales previas);
// - 67: las cortesías salen como línea gratuita en el comprobante del primer cobro; las bolsas salen enteras;
// - 68: la mesa queda ocupada hasta pagar todas las partes; cada parte con su comprobante, caja y tipo.
// Los comprobantes se leen por SQL (tablas de facturación) porque el detalle por línea es lo que se compara.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  CLIENTE_RUC,
  cerrarAdmin,
  cobrar,
  cobrarCrudo,
  cobrosDeLaOrden,
  comprobantesDeLaOrden,
  crearEscenario,
  cuentaC,
  cuentaCon,
  cuerpoDeCobro,
  efectivo,
  escribir,
  esperarError,
  estadoDeMesa,
  estadoDeOrden,
  exigirEstado,
  filas,
  versionDe,
  type AppP5,
  type Cuenta,
  type Escenario,
} from './fabrica-caja';

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
const turno1 = () =>
  (turnoCajero ??= (async () =>
    abrirTurno(ctx, A().token.cajero!, (await A().cajas()).S1!.caja1))());
let turnoCajero2: Promise<string> | undefined;
const turno2 = () =>
  (turnoCajero2 ??= (async () =>
    abrirTurno(ctx, A().token.cajero2!, (await A().cajas()).S1!.caja2))());

const itemsLomoYGaseosa = (c: Cuenta) => ({
  tipo: 'ITEMS',
  items: [
    { itemId: c.item.lomo!, cantidad: 1 },
    { itemId: c.item.gaseosa!, cantidad: 1 },
  ],
});
const iguales = (r: number) => ({ tipo: 'IGUALES', partesRestantes: r });

/** Las líneas guardadas de un comprobante, en su orden. */
const lineasDe = (comprobanteId: string) =>
  filas('SELECT * FROM comprobante_linea WHERE comprobante_id = $1 ORDER BY posicion', [
    comprobanteId,
  ]);

describe('criterio 64 · por ítems', () => {
  it('cuenta C: 1 Lomo + 1 Gaseosa (37.00) y después TOTAL (32.20), que cierra la orden', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno1();
    const primera = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '37.00',
      parte: itemsLomoYGaseosa(cuenta),
    });
    expect(primera.comprobante.totales.total).toBe('37.00');
    expect(primera.cuenta).toMatchObject({ estado: 'ABIERTA', saldo: '32.20' });
    const segunda = await cobrar(ctx, A().token.cajero!, cuenta, { turnoId, total: '32.20' });
    expect(segunda).toMatchObject({ total: '32.20', cuenta: { estado: 'CERRADA', saldo: '0.00' } });
    const comprobantes = await comprobantesDeLaOrden(cuenta.ordenId);
    expect(comprobantes.map((c) => Number(c.numero_parte))).toEqual([1, 2]);
    expect(comprobantes.map((c) => c.total)).toEqual(['37.00', '32.20']);
    // La segunda parte lleva 1 Lomo, 2 Bolsas con su ICBPER y la Mandarina.
    const lineas = await lineasDe(comprobantes[1]!.id);
    expect(lineas.reduce((s, l) => s + Number(l.bolsas), 0)).toBe(2);
    expect(lineas.reduce((s, l) => s + Number(l.icbper), 0).toFixed(2)).toBe('1.00');
  });

  it('el mismo comprobante puede ir por consumo: una línea por afectación y las bolsas detalladas', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: await turno1(),
      total: '69.20',
      formato: 'CONSUMO',
    });
    const lineas = await lineasDe(cobro.comprobante.id);
    const consumo = lineas.filter((l) => !l.gratuita && Number(l.bolsas) === 0);
    expect(consumo.map((l) => l.afectacion).sort()).toEqual(['EXONERADO', 'GRAVADO']);
    // Las líneas "Por consumo" son de una unidad en ZZ y su precio unitario es su bruto.
    for (const l of consumo) {
      expect(l).toMatchObject({ descripcion: 'Por consumo', cantidad: 1, unidad: 'ZZ' });
      expect(l.precio_unitario).toBe(l.bruto);
    }
    expect(lineas.filter((l) => Number(l.bolsas) > 0)).toHaveLength(1);
  });

  it('pedir más unidades de las que faltan o un ítem repetido o ajeno es 422 PARTE_INVALIDA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const otra = await cuentaC(ctx, A());
    const turnoId = await turno1();
    const version = await versionDe(cuenta.ordenId);
    const casos = [
      { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 3 }] },
      {
        tipo: 'ITEMS',
        items: [
          { itemId: cuenta.item.lomo!, cantidad: 1 },
          { itemId: cuenta.item.lomo!, cantidad: 1 },
        ],
      },
      { tipo: 'ITEMS', items: [{ itemId: otra.item.lomo!, cantidad: 1 }] },
      { tipo: 'ITEMS', items: [{ itemId: randomUUID(), cantidad: 1 }] },
    ];
    for (const parte of casos) {
      const res = await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version, total: '28.00', parte }),
      );
      esperarError(res, 422, 'PARTE_INVALIDA');
    }
    expect(await cobrosDeLaOrden(cuenta.ordenId)).toEqual([]);
  });
});

describe('criterio 65 · en partes iguales', () => {
  it('cuenta C en 2 partes: 34.60 con partesRestantes 2 y 34.60 con partesRestantes 1, que cierra la orden', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno1();
    const primera = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '34.60',
      parte: iguales(2),
      formato: 'CONSUMO',
      pagos: [efectivo('34.60')],
    });
    expect(primera.cuenta).toMatchObject({ estado: 'ABIERTA', saldo: '34.60' });
    // El consumo gravado, el exonerado y una bolsa (con su ICBPER) con los montos del ejemplo.
    const lineas = await lineasDe(primera.comprobante.id);
    const gravado = lineas.find(
      (l) => l.afectacion === 'GRAVADO' && Number(l.bolsas) === 0 && !l.gratuita,
    )!;
    expect(gravado).toMatchObject({ neto: '32.50', base: '27.54', igv: '4.96' });
    const exonerado = lineas.find((l) => l.afectacion === 'EXONERADO')!;
    expect(exonerado).toMatchObject({ neto: '1.50', base: '1.50', igv: '0.00' });
    const bolsa = lineas.find((l) => Number(l.bolsas) > 0)!;
    expect(bolsa).toMatchObject({
      bolsas: 1,
      neto: '0.10',
      base: '0.08',
      igv: '0.02',
      icbper: '0.50',
    });
    expect(primera.comprobante.totales.total).toBe('34.60');

    const segunda = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '34.60',
      parte: iguales(1),
      formato: 'CONSUMO',
      pagos: [efectivo('34.60')],
    });
    expect(segunda.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
  });

  it('un saldo de 100.00 en 3 partes: 33.34, 33.33 y 33.33, con la base y el IGV del ejemplo', async () => {
    // Lomo × 1 (28.00) + Gaseosa × 4 (36.00) + Pisco sour × 3 (36.00), todo gravado.
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 1],
      ['gaseosa', 4],
      ['pisco', 3],
    ]);
    const turnoId = await turno1();
    const hechas = [];
    for (const [restantes, monto] of [
      [3, '33.34'],
      [2, '33.33'],
      [1, '33.33'],
    ] as const) {
      hechas.push(
        await cobrar(ctx, A().token.cajero!, cuenta, {
          turnoId,
          total: monto,
          parte: iguales(restantes),
          formato: 'CONSUMO',
          pagos: [{ medio: 'YAPE', monto, operacion: `Y-${restantes}` }],
        }),
      );
    }
    expect(hechas[2]!.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
    const consumo = await Promise.all(
      hechas.map(async (h) =>
        (await lineasDe(h.comprobante.id)).find((l) => l.afectacion === 'GRAVADO')!,
      ),
    );
    expect(consumo.map((l) => [l.base, l.igv])).toEqual([
      ['28.25', '5.09'],
      ['28.25', '5.08'],
      ['28.25', '5.08'],
    ]);
    const suma = (await comprobantesDeLaOrden(cuenta.ordenId)).reduce(
      (t, c) => t + Number(c.total),
      0,
    );
    expect(suma.toFixed(2)).toBe('100.00');
  });
});

describe('criterio 66 · el orden de los modos', () => {
  it('después de una parte igual no se puede cobrar por ítems ni TOTAL: 422 PARTE_INVALIDA', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno1();
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '34.60',
      parte: iguales(2),
      formato: 'CONSUMO',
    });
    const version = await versionDe(cuenta.ordenId);
    for (const parte of [itemsLomoYGaseosa(cuenta), { tipo: 'TOTAL' }]) {
      const res = await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version, total: '34.60', parte }),
      );
      esperarError(res, 422, 'PARTE_INVALIDA');
    }
    // IGUALES con partesRestantes 1 sí cierra la cuenta.
    const ultima = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '34.60',
      parte: iguales(1),
      formato: 'CONSUMO',
    });
    expect(ultima.cuenta.estado).toBe('CERRADA');
  });

  it('se puede cobrar por ítems y dividir el resto en partes iguales', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno1();
    await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '37.00',
      parte: itemsLomoYGaseosa(cuenta),
    });
    // Saldo 32.20 entre 2: 16.10 cada una, con una bolsa en cada parte.
    const p1 = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '16.10',
      parte: iguales(2),
      formato: 'CONSUMO',
    });
    expect(p1.cuenta).toMatchObject({ estado: 'ABIERTA', saldo: '16.10' });
    const p2 = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '16.10',
      parte: iguales(1),
      formato: 'CONSUMO',
    });
    expect(p2.cuenta).toMatchObject({ estado: 'CERRADA', saldo: '0.00' });
  });
});

describe('criterio 67 · cortesías y bolsas en las partes', () => {
  it('la cortesía sale como línea gratuita en el primer comprobante y no en el segundo', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 2],
      ['gaseosa', 1],
      ['bolsa', 2],
    ]);
    const cortesia = await escribir(
      ctx,
      A().token.supervisor!,
      'post',
      `/cuentas/${cuenta.ordenId}/cortesias`,
      {
        id: randomUUID(),
        itemId: cuenta.item.gaseosa,
        cantidad: 1,
        motivo: 'Atención de la casa',
      },
    );
    exigirEstado(cortesia, 201, 'Cortesía de la Gaseosa (006, criterio 43)');
    const turnoId = await turno1();
    const primera = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '28.00',
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.lomo!, cantidad: 1 }] },
    });
    const segunda = await cobrar(ctx, A().token.cajero!, cuenta, { turnoId, total: '29.20' });
    const gratuitas = async (id: string) => (await lineasDe(id)).filter((l) => l.gratuita);
    const g1 = await gratuitas(primera.comprobante.id);
    expect(g1).toHaveLength(1);
    // Una línea gratuita no cobra nada (todo en cero) y lleva su valor referencial con su base y su IGV.
    expect(g1[0]).toMatchObject({
      bruto: '0.00',
      descuento: '0.00',
      neto: '0.00',
      base: '0.00',
      igv: '0.00',
      unidad: 'NIU',
      valor_referencial: '9.00',
      base_referencial: '7.63',
      igv_referencial: '1.37',
    });
    expect(await gratuitas(segunda.comprobante.id)).toEqual([]);
  });

  it('las bolsas salen enteras: 3 bolsas en 2 partes iguales son 2 y 1', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 1],
      ['bolsa', 3],
    ]);
    // 28.00 + 3 × 0.10 + 3 × 0.50 = 29.80 → 14.90 cada parte
    const turnoId = await turno1();
    const p1 = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '14.90',
      parte: iguales(2),
      formato: 'CONSUMO',
    });
    const p2 = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId,
      total: '14.90',
      parte: iguales(1),
      formato: 'CONSUMO',
    });
    const bolsas = async (id: string) =>
      (await lineasDe(id)).reduce((s, l) => s + Number(l.bolsas), 0);
    expect(await bolsas(p1.comprobante.id)).toBe(2);
    expect(await bolsas(p2.comprobante.id)).toBe(1);
  });
});

describe('criterio 68 · la mesa queda ocupada hasta pagar todas las partes', () => {
  it('tres partes en dos cajas y con una factura y dos boletas: la mesa se libera con la última', async () => {
    const cuenta = await cuentaC(ctx, A());
    const t1 = await turno1();
    const t2 = await turno2();
    const mozo = A().token.mozo!;
    const cajas = await A().cajas();

    const p1 = await cobrar(ctx, A().token.cajero!, cuenta, {
      turnoId: t1,
      total: '37.00',
      parte: itemsLomoYGaseosa(cuenta),
      tipo: 'FACTURA',
      cliente: CLIENTE_RUC,
    });
    expect(await estadoDeMesa(ctx, mozo, cuenta.mesaId)).toBe('OCUPADA');
    const p2 = await cobrar(ctx, A().token.cajero2!, cuenta, {
      turnoId: t2,
      total: '31.00',
      parte: {
        tipo: 'ITEMS',
        items: [
          { itemId: cuenta.item.lomo!, cantidad: 1 },
          { itemId: cuenta.item.mandarina!, cantidad: 1 },
        ],
      },
    });
    expect(await estadoDeMesa(ctx, mozo, cuenta.mesaId)).toBe('OCUPADA');
    expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
    const p3 = await cobrar(ctx, A().token.cajero!, cuenta, { turnoId: t1, total: '1.20' });
    expect(p3.cuenta.estado).toBe('CERRADA');
    expect(await estadoDeMesa(ctx, mozo, cuenta.mesaId)).toBe('LIBRE');

    const comprobantes = await comprobantesDeLaOrden(cuenta.ordenId);
    expect(comprobantes.map((c) => [c.tipo, c.serie, c.caja_id])).toEqual([
      ['FACTURA', 'F001', cajas.S1!.caja1],
      ['BOLETA', 'B002', cajas.S1!.caja2],
      ['BOLETA', 'B001', cajas.S1!.caja1],
    ]);
    expect([p1, p2, p3].map((p) => p.comprobante.totales.total)).toEqual([
      '37.00',
      '31.00',
      '1.20',
    ]);
    void api;
  });
});
