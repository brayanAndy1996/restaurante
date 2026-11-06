// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P8 · La devolución como egreso del turno (ruta crítica), criterio 150 (y el 136 en el esperado del X y de la Z):
// - un `movimiento_caja` `EGRESO` por pago, en su medio, con `comprobante_id` = la nota, la `operacion` fuera del efectivo y
//   el motivo «Devolución NC <serie>-<número>»;
// - los pagos cumplen `validarPagos` (sin `recibido`): Σ monto + redondeo = total de la nota, y lo devuelto en efectivo se
//   trunca a la décima (33.34 → 33.30 con redondeo 0.04); si no, 422 `DEVOLUCION_INVALIDA`;
// - el turno debe ser `ABIERTO`, de la sucursal activa y de quien emite (o quien emite es Supervisor o Administrador):
//   404, 409 `TURNO_CERRADO` y 409 `TURNO_AJENO`; sin turno abierto la nota se emite sin devolución;
// - los egresos entran en el esperado de su medio en el X y en la Z, y las notas de crédito, las reemisiones y las facturas
//   de cambio no cuentan en las ventas (criterio 136).
// Hoy falla por "No implementado": `POST /notas-credito` y el worker lanzan `Error('No implementado')` y las series de notas de
// crédito todavía no existen.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  api,
  cerrarAdmin,
  cerrarTurnoCrudo,
  conteo,
  crearEscenario,
  CLIENTE_RUC,
  esperarError,
  exigir,
  type Escenario,
} from '../caja-critica/fabrica-caja';
import {
  arrancarNotas,
  autorizarNota,
  cuerpoNota,
  efectivo,
  egresosDe,
  emitirAceptado,
  emitirNota,
  filaDeNota,
  notaCrudo,
  notasDelOriginal,
  objetivoNota,
  prepararNotas,
  turnoAbiertoDe,
  yape,
  contarFilas,
  type AppNotas,
  type Libre,
} from './fabrica-notas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppNotas;
let esc: Escenario;
const A = () => esc.A;
const B = () => esc.B;
const sup = () => A().token.supervisor!;

beforeAll(async () => {
  ctx = await arrancarNotas();
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

const boleta = async (o: Parameters<typeof emitirAceptado>[2] = {}) => {
  await prepararNotas(ctx, esc);
  return emitirAceptado(ctx, A(), o);
};

const posicionDe = (comprobante: Libre, descripcion: RegExp): number =>
  (comprobante.lineas as Libre[]).find((l) => descripcion.test(l.descripcion as string))!
    .posicion as number;

describe('criterio 150 · egresos por medio', () => {
  it('un pago en Yape: un egreso de YAPE con el número de operación, el motivo de la nota y la nota como comprobante', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '9.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Gaseosa/), cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [yape('9.00', 'OP-DEV-1')], redondeo: '0.00' },
    });
    const nota = res.nota as Libre;
    expect(nota.turnoId).toBe(o.turnoId);
    expect(res.devolucion).toMatchObject({
      total: '9.00',
      redondeo: '0.00',
      pagos: [{ medio: 'YAPE', monto: '9.00', operacion: 'OP-DEV-1' }],
    });
    const egresos = await egresosDe(nota.id as string);
    expect(egresos).toHaveLength(1);
    expect(egresos[0]).toMatchObject({
      tipo: 'EGRESO',
      medio: 'YAPE',
      monto: '9.00',
      operacion: 'OP-DEV-1',
      turno_id: o.turnoId,
      comprobante_id: nota.id,
      motivo: `Devolución NC ${nota.numero as string}`,
    });
    expect(res.devolucion.movimientoIds).toEqual([egresos[0]!.id]);
    expect(await filaDeNota(nota.id as string)).toMatchObject({
      tipo: 'DEVOLUCION',
      total: '9.00',
      devuelto: '9.00',
      turno_id: o.turnoId,
    });
  });

  it('varios medios: un egreso por pago, cada uno en su medio, y el efectivo sin número de operación', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
      devolucion: {
        turnoId: o.turnoId,
        pagos: [
          efectivo('10.00'),
          yape('8.00', 'OP-A-1'),
          { medio: 'TARJETA_CREDITO', monto: '10.00', operacion: 'VCH-77' },
        ],
        redondeo: '0.00',
      },
    });
    const egresos = await egresosDe((res.nota as Libre).id as string);
    expect(egresos.map((e) => [e.medio, e.monto, e.operacion]).sort()).toEqual(
      [
        ['EFECTIVO', '10.00', null],
        ['TARJETA_CREDITO', '10.00', 'VCH-77'],
        ['YAPE', '8.00', 'OP-A-1'],
      ].sort(),
    );
    expect(res.devolucion.movimientoIds).toHaveLength(3);
    expect(await filaDeNota((res.nota as Libre).id as string)).toMatchObject({ devuelto: '28.00' });
  });

  it('todo en efectivo, nota de 33.34: se devuelven 33.30 con redondeo 0.04 y el egreso es de 33.30', async () => {
    const o = await boleta({
      lineas: [
        ['lomo', 1],
        ['tostada', 1],
      ],
      total: '33.34',
      pagos: [efectivo('33.30')],
      redondeo: '0.04',
    });
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '33.34',
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('33.30')], redondeo: '0.04' },
    });
    expect(res.devolucion).toMatchObject({
      total: '33.34',
      redondeo: '0.04',
      pagos: [{ medio: 'EFECTIVO', monto: '33.30' }],
    });
    const egresos = await egresosDe((res.nota as Libre).id as string);
    expect(egresos.map((e) => e.monto)).toEqual(['33.30']);
  });

  it('el redondeo es solo del efectivo: con Yape y efectivo, lo de Yape va exacto', async () => {
    const o = await boleta({
      lineas: [
        ['lomo', 1],
        ['tostada', 1],
      ],
      total: '33.34',
      pagos: [efectivo('33.30')],
      redondeo: '0.04',
    });
    // 33.34 = 20.00 en Yape + 13.34 → 13.30 en efectivo y 0.04 de redondeo.
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '33.34',
      devolucion: {
        turnoId: o.turnoId,
        pagos: [yape('20.00', 'OP-B-1'), efectivo('13.30')],
        redondeo: '0.04',
      },
    });
    expect(res.devolucion.pagos).toHaveLength(2);
    expect(await egresosDe((res.nota as Libre).id as string)).toHaveLength(2);
  });
});

describe('criterio 150 · DEVOLUCION_INVALIDA', () => {
  it('Σ monto + redondeo distinto del total, redondeo mal calculado o sin efectivo: 422 y no se emite ni se registra nada', async () => {
    const o = await boleta({
      lineas: [
        ['lomo', 1],
        ['tostada', 1],
      ],
      total: '33.34',
      pagos: [efectivo('33.30')],
      redondeo: '0.04',
    });
    const egresosAntes = await contarFilas('SELECT 1 FROM movimiento_caja WHERE turno_id = $1', [
      o.turnoId,
    ]);
    const intento = (pagos: Libre[], redondeo: string) =>
      notaCrudo(
        ctx,
        sup(),
        cuerpoNota({
          comprobanteId: o.comprobanteId,
          tipo: 'ANULACION',
          total: '33.34',
          devolucion: { turnoId: o.turnoId, pagos: pagos as never, redondeo },
        }),
      );
    const casos: Array<[string, Promise<{ status: number; body: Libre; text: string }>]> = [
      ['no cubre el total', intento([efectivo('20.00')], '0.00')],
      ['se pasa del total', intento([efectivo('40.00')], '0.00')],
      ['el efectivo sin truncar a la décima', intento([efectivo('33.34')], '0.00')],
      ['el redondeo que no es el de la décima', intento([efectivo('33.30')], '0.03')],
      ['redondeo sin efectivo', intento([yape('33.34', 'OP-C-1')], '0.04')],
      ['todo con Yape pero con redondeo', intento([yape('33.30', 'OP-C-2')], '0.04')],
    ];
    const fallos: string[] = [];
    for (const [que, promesa] of casos) {
      const res = await promesa;
      if (res.status !== 422 || res.body?.codigo !== 'DEVOLUCION_INVALIDA') {
        fallos.push(`${que}: ${res.status} ${res.body?.codigo ?? res.text.slice(0, 80)}`);
      }
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
    expect(
      await contarFilas('SELECT 1 FROM movimiento_caja WHERE turno_id = $1', [o.turnoId]),
    ).toBe(egresosAntes);
  });

  it('dos pagos del mismo medio no se aceptan (a lo más uno por medio)', async () => {
    const o = await boleta();
    const res = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'DEVOLUCION',
        total: '28.00',
        lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
        devolucion: {
          turnoId: o.turnoId,
          pagos: [yape('14.00', 'OP-D-1'), yape('14.00', 'OP-D-2')],
          redondeo: '0.00',
        },
      }),
    );
    expect([400, 422]).toContain(res.status);
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });
});

describe('criterio 150 · el turno de la devolución', () => {
  it('un turno cerrado es 409 TURNO_CERRADO', async () => {
    const o = await boleta();
    const cajas = await A().cajas();
    const turnoCaja3 = await turnoAbiertoDe(ctx, sup(), cajas.S1!.caja3, '50.00');
    const cierre = await cerrarTurnoCrudo(ctx, sup(), turnoCaja3, conteo({ EFECTIVO: '50.00' }));
    exigir(cierre, 200, 'Cerrar el turno de la caja 3');
    const res = await notaCrudo(
      ctx,
      sup(),
      cuerpoNota({
        comprobanteId: o.comprobanteId,
        tipo: 'ANULACION',
        total: '69.20',
        devolucion: { turnoId: turnoCaja3, pagos: [efectivo('69.20')], redondeo: '0.00' },
      }),
    );
    esperarError(res, 409, 'TURNO_CERRADO');
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });

  it('el turno de otra persona: un Cajero recibe 409 TURNO_AJENO (con su clave); el Supervisor sí puede devolver en el turno del Cajero', async () => {
    const delCajero2 = await boleta({ quien: 'cajero2', caja: 'caja2' });
    const turnoDelCajero1 = await turnoAbiertoDe(
      ctx,
      A().token.cajero!,
      (await A().cajas()).S1!.caja1,
    );
    const ajeno = cuerpoNota({
      comprobanteId: delCajero2.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
      devolucion: { turnoId: turnoDelCajero1, pagos: [efectivo('69.20')], redondeo: '0.00' },
    });
    const clave = await autorizarNota(
      ctx,
      A().token.cajero2!,
      A().personas.supervisor!.pin,
      objetivoNota(delCajero2.comprobanteId, 'ANULACION', '69.20', '69.20'),
    );
    const res = await notaCrudo(ctx, A().token.cajero2!, ajeno, {
      autorizacion: clave.autorizacionId,
    });
    esperarError(res, 409, 'TURNO_AJENO');
    expect(await notasDelOriginal(delCajero2.comprobanteId)).toEqual([]);
    const delSupervisor = await emitirNota(ctx, sup(), {
      comprobanteId: delCajero2.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
      devolucion: { turnoId: turnoDelCajero1, pagos: [efectivo('69.20')], redondeo: '0.00' },
    });
    expect((delSupervisor.nota as Libre).turnoId).toBe(turnoDelCajero1);
  });

  it('un turno de otra sucursal o de otra empresa es 404, y el de otra empresa con el mismo cuerpo que uno inexistente', async () => {
    const o = await boleta();
    const turnoS3 = await turnoAbiertoDe(ctx, A().token.cajeroS3!, (await A().cajas()).S3!.caja1);
    const turnoDeB = await turnoAbiertoDe(ctx, B().token.cajero!, (await B().cajas()).S1!.caja1);
    const pedir = (turnoId: string) =>
      notaCrudo(
        ctx,
        sup(),
        cuerpoNota({
          comprobanteId: o.comprobanteId,
          tipo: 'ANULACION',
          total: '69.20',
          devolucion: { turnoId, pagos: [efectivo('69.20')], redondeo: '0.00' },
        }),
      );
    const deS3 = await pedir(turnoS3);
    const deB = await pedir(turnoDeB);
    const inexistente = await pedir(randomUUID());
    expect(deS3.status, deS3.text).toBe(404);
    expect(deB.status, deB.text).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(deB.body).toEqual(inexistente.body);
    expect(await notasDelOriginal(o.comprobanteId)).toEqual([]);
  });

  it('sin turno abierto la nota se emite sin devolución (devolucion: null) y no registra egresos', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
      devolucion: null,
    });
    expect(res.devolucion).toBeNull();
    expect((res.nota as Libre).turnoId).toBeNull();
    expect(await egresosDe((res.nota as Libre).id as string)).toEqual([]);
    expect(await filaDeNota((res.nota as Libre).id as string)).toMatchObject({
      devuelto: '0.00',
      turno_id: null,
    });
  });
});

describe('criterio 136 y 150 · el X y la Z con las devoluciones', () => {
  it('los egresos restan del esperado de su medio, las notas y el cambio de factura no cuentan como ventas y la Z cierra con ese esperado', async () => {
    await prepararNotas(ctx, esc);
    const quien = { sucursal: 'S3', caja: 'caja1', quien: 'cajeroS3' } as const;
    const enEfectivo = await emitirAceptado(ctx, A(), quien);
    const conYape = await emitirAceptado(ctx, A(), { ...quien, pagos: [yape('69.20', 'OP-X-1')] });
    const paraCambio = await emitirAceptado(ctx, A(), quien);
    const turnoId = enEfectivo.turnoId;
    expect(conYape.turnoId).toBe(turnoId);
    const supervisorS3 = A().token.supervisorS3!;

    // 1 Lomo devuelto en efectivo (28.00) y 1 Gaseosa devuelta por Yape (9.00).
    await emitirNota(ctx, supervisorS3, {
      comprobanteId: enEfectivo.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: posicionDe(enEfectivo.cobro.comprobante, /Lomo/), cantidad: 1 }],
      devolucion: { turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    await emitirNota(ctx, supervisorS3, {
      comprobanteId: conYape.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '9.00',
      lineas: [{ posicion: posicionDe(conYape.cobro.comprobante, /Gaseosa/), cantidad: 1 }],
      devolucion: { turnoId, pagos: [yape('9.00', 'OP-X-2')], redondeo: '0.00' },
    });
    // Un cambio de boleta por factura (la nota y la factura no son dinero nuevo).
    await emitirNota(ctx, supervisorS3, {
      comprobanteId: paraCambio.comprobanteId,
      tipo: 'CAMBIO_A_FACTURA',
      total: '69.20',
      cliente: CLIENTE_RUC,
    });

    const reporte = await api(ctx, supervisorS3, 'get', `/turnos/${turnoId}/reporte`);
    exigir(reporte, 200, 'Reporte X del turno (006, criterio 29)');
    const x = reporte.body as Libre;
    const esperado = (medio: string) =>
      (x.esperado as Libre[]).find((e) => e.medio === medio)!.monto as string;
    // Fondo 200.00 + 2 boletas en efectivo (69.20 × 2) − 28.00; Yape 69.20 − 9.00.
    expect(esperado('EFECTIVO')).toBe('310.40');
    expect(esperado('YAPE')).toBe('60.20');
    expect(esperado('TARJETA_CREDITO')).toBe('0.00');
    // Las ventas son solo los tres cobros: ni las notas ni la factura del cambio suman.
    expect(x.ventas).toMatchObject({ total: '207.60', cantidad: 3 });
    const porTipo = x.ventas.porTipo as Libre[];
    expect(porTipo.find((t) => t.tipo === 'BOLETA')).toMatchObject({
      cantidad: 3,
      total: '207.60',
    });
    expect(porTipo.filter((t) => t.tipo === 'FACTURA' && t.cantidad > 0)).toEqual([]);
    // Cuentan las notas emitidas con este turno (las que devolvieron dinero); la anulación del cambio no tiene turno.
    expect(x.notasCredito).toMatchObject({ cantidad: 2, total: '37.00', devuelto: '37.00' });
    const lista = (x.movimientos.lista as Libre[]).filter((m) => m.comprobanteId);
    expect(lista.map((m) => [m.medio, m.monto, m.tipo]).sort()).toEqual(
      [
        ['EFECTIVO', '28.00', 'EGRESO'],
        ['YAPE', '9.00', 'EGRESO'],
      ].sort(),
    );

    // La Z cierra con el mismo esperado y la guarda por medio.
    const cierre = await cerrarTurnoCrudo(
      ctx,
      supervisorS3,
      turnoId,
      conteo({ EFECTIVO: '310.40', YAPE: '60.20' }),
    );
    exigir(cierre, 200, 'Cerrar el turno (006, criterio 31)');
    const z = cierre.body as Libre;
    const delCierre = (medio: string) =>
      (z.cierre.conteo as Libre[]).find((c) => c.medio === medio)!;
    expect(delCierre('EFECTIVO')).toMatchObject({
      esperado: '310.40',
      contado: '310.40',
      diferencia: '0.00',
    });
    expect(delCierre('YAPE')).toMatchObject({
      esperado: '60.20',
      contado: '60.20',
      diferencia: '0.00',
    });
    expect(z.ventas).toMatchObject({ total: '207.60', cantidad: 3 });
  });
});
