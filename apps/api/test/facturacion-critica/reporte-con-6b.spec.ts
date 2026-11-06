// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · El X y la Z con 6b (ruta crítica), criterio 136, sin romper la Z definitiva (criterio 34):
// - las ventas del reporte (`ventas.total`, `cantidad`, `porTipo`) suman solo los comprobantes nacidos de un cobro
//   (`cobro_id` no nulo): ni las notas de crédito, ni las reemisiones, ni las facturas de cambio;
// - tampoco dependen del estado ante SUNAT: el reporte de un turno (abierto o cerrado) no cambia cuando llega una
//   aceptación o un rechazo del PSE, ni con una reemisión;
// - `reporteCaja` gana `notasCredito` `{ cantidad, total, devuelto }` con las notas de crédito emitidas con ese turno;
// - el esperado de cada medio resta los egresos de ese medio: con fondo `"200.00"`, la cuenta C en efectivo (`"69.20"`),
//   otra pagada con Yape (`"69.20"`), una nota de 1 Lomo devuelta en efectivo (`"28.00"`) y otra de 1 Gaseosa devuelta por
//   Yape (`"9.00"`): esperado `EFECTIVO "241.20"` y `YAPE "60.20"`, y `ventas.total` sigue en `"138.40"`.
// Hoy falla porque `envio_pse`, las notas de crédito y las columnas de 6b no existen y las rutas responden «No implementado».
import { reporteCajaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { memorizar } from '../impresion-critica/fabrica-p5';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarFact,
  cerrarAdmin,
  cerrarTurnoCrudo,
  CLIENTE_RUC,
  cobrar,
  cobrarLomo,
  comprobanteFila,
  conteo,
  crearEscenarioFact,
  cuentaC,
  escribir,
  exigirEstado,
  exigirPse,
  limitarBarrido,
  procesar,
  seriesDeNotas,
  yape,
  type AppFact,
  type Cobrado,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
const A = () => esc.A;
let restaurarBarrido: () => void;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  ctx.pse.reglas.limpiar();
});

const cajero = () => A().token.cajero!;
const cajero2 = () => A().token.cajero2!;
const supervisor = () => A().token.supervisor!;

async function reporte(turnoId: string, token: string = supervisor()) {
  const res = await api(ctx, token, 'get', `/turnos/${turnoId}/reporte`);
  exigirEstado(res, 200, 'GET /turnos/:id/reporte (006, criterio 29)');
  return reporteCajaSchema.parse(res.body);
}
/** El reporte sin la hora en que se generó. */
async function fijo(turnoId: string) {
  const { generadoEn, ...resto } = await reporte(turnoId);
  void generadoEn;
  return resto;
}
const esperadoDe = (r: { esperado: Array<{ medio: string; monto: string }> }, medio: string) =>
  r.esperado.find((e) => e.medio === medio)?.monto;
const porTipoConVentas = (r: {
  ventas: { porTipo: Array<{ tipo: string; cantidad: number; total: string }> };
}) => r.ventas.porTipo.filter((t) => t.cantidad > 0);
const numeroDe = (c: Cobrado): string => (c.respuesta.comprobante as { numero: string }).numero;
const posicionDe = (c: Cobrado, producto: RegExp): number =>
  ((c.respuesta.comprobante as Libre).lineas as Libre[]).find((l) =>
    producto.test(l.descripcion as string),
  )!.posicion as number;

describe('criterio 136 · el ejemplo del esperado con devoluciones en efectivo y en Yape', () => {
  let turnoId: string;
  let b1: Cobrado;
  let b2: Cobrado;

  async function cobrarComo(
    cuenta: Awaited<ReturnType<typeof cuentaC>>,
    o: { total: string; pagos?: Libre[] },
  ): Promise<Cobrado> {
    const respuesta = await cobrar(ctx, cajero(), cuenta, { turnoId, ...o });
    return {
      comprobanteId: (respuesta.comprobante as Libre).id as string,
      cobroId: respuesta.id as string,
      ordenId: cuenta.ordenId,
      turnoId,
      cuenta,
      respuesta,
    };
  }

  /** Fondo 200.00, la cuenta C en efectivo y otra con Yape (las ventas, 138.40). */
  const cobros = memorizar(async () => {
    const cajas = await A().cajas();
    turnoId = await abrirTurno(ctx, cajero(), cajas.S1!.caja1, '200.00');
    b1 = await cobrarComo(await cuentaC(ctx, A()), { total: '69.20' });
    b2 = await cobrarComo(await cuentaC(ctx, A()), { total: '69.20', pagos: [yape('69.20')] });
  });

  /** Las dos boletas aceptadas y las dos notas de devolución emitidas por el Supervisor. */
  const devoluciones = memorizar(async () => {
    await cobros();
    await seriesDeNotas(ctx, A());
    await procesar(ctx, A().id, b1.comprobanteId);
    await procesar(ctx, A().id, b2.comprobanteId);
    const nota = (original: Cobrado, producto: RegExp, total: string, pago: Libre) =>
      escribir(ctx, supervisor(), 'post', '/notas-credito', {
        id: randomUUID(),
        comprobanteId: original.comprobanteId,
        tipo: 'DEVOLUCION',
        motivo: 'El cliente devuelve un plato',
        total,
        lineas: [{ posicion: posicionDe(original, producto), cantidad: 1 }],
        devolucion: { turnoId, pagos: [pago], redondeo: '0.00' },
      });
    exigirEstado(
      await nota(b1, /Lomo/i, '28.00', { medio: 'EFECTIVO', monto: '28.00' }),
      201,
      'Nota de 1 Lomo devuelta en efectivo (006, criterio 150)',
    );
    exigirEstado(
      await nota(b2, /Gaseosa/i, '9.00', { medio: 'YAPE', monto: '9.00', operacion: 'DEV-0001' }),
      201,
      'Nota de 1 Gaseosa devuelta por Yape (006, criterio 150)',
    );
  });

  it('las notas de 1 Lomo (efectivo 28.00) y de 1 Gaseosa (Yape 9.00) dejan EFECTIVO 241.20 y YAPE 60.20; las ventas siguen en 138.40', async () => {
    await cobros();
    const antes = await reporte(turnoId);
    expect(antes.ventas).toMatchObject({ total: '138.40', cantidad: 2 });
    expect(esperadoDe(antes, 'EFECTIVO')).toBe('269.20');
    expect(esperadoDe(antes, 'YAPE')).toBe('69.20');

    await devoluciones();
    const x = await reporte(turnoId);
    expect(esperadoDe(x, 'EFECTIVO')).toBe('241.20');
    expect(esperadoDe(x, 'YAPE')).toBe('60.20');
    // Las ventas no cambian: las notas no son dinero nuevo.
    expect(x.ventas).toEqual(antes.ventas);
    expect(x.ventas).toMatchObject({ total: '138.40', cantidad: 2 });
    expect(porTipoConVentas(x)).toEqual([{ tipo: 'BOLETA', cantidad: 2, total: '138.40' }]);
    expect(x.notasCredito).toEqual({ cantidad: 2, total: '37.00', devuelto: '37.00' });
  });

  it('la Z (cierre) usa el mismo esperado con los egresos de cada medio y queda sin diferencias', async () => {
    await devoluciones();
    const res = await cerrarTurnoCrudo(
      ctx,
      cajero(),
      turnoId,
      conteo({ EFECTIVO: '241.20', YAPE: '60.20' }),
    );
    exigirEstado(res, 200, 'Cerrar el turno con devoluciones (006, criterio 31)');
    const z = reporteCajaSchema.parse(res.body);
    const deMedio = (m: string) => z.cierre!.conteo.find((c) => c.medio === m)!;
    expect(deMedio('EFECTIVO')).toMatchObject({
      esperado: '241.20',
      contado: '241.20',
      diferencia: '0.00',
    });
    expect(deMedio('YAPE')).toMatchObject({
      esperado: '60.20',
      contado: '60.20',
      diferencia: '0.00',
    });
    expect(z.ventas).toMatchObject({ total: '138.40', cantidad: 2 });
    expect(z.notasCredito).toEqual({ cantidad: 2, total: '37.00', devuelto: '37.00' });
  });

  it('las notas aceptadas por el PSE después de cerrado el turno no cambian la Z', async () => {
    await devoluciones();
    const z = await fijo(turnoId);
    const ids: string[] = [];
    for (const o of [b1, b2]) {
      const detalle = await api(ctx, supervisor(), 'get', `/comprobantes/${o.comprobanteId}`);
      exigirEstado(detalle, 200, 'Detalle del original');
      for (const n of (detalle.body.notasCredito as Libre[]) ?? []) ids.push(n.id as string);
    }
    expect(ids).toHaveLength(2);
    for (const id of ids) await procesar(ctx, A().id, id);
    expect(await fijo(turnoId)).toEqual(z);
  });
});

describe('criterio 136 · el reporte no depende del estado ante SUNAT ni de las reemisiones', () => {
  let turnoId: string;
  let aceptada: Cobrado;
  let rechazada: Cobrado;
  let tardia: Cobrado;
  let xInicial: Awaited<ReturnType<typeof fijo>>;

  it('el X de un turno abierto no cambia al llegar una aceptación y un rechazo ni al reemitir el rechazado', async () => {
    const cajas = await A().cajas();
    turnoId = await abrirTurno(ctx, cajero2(), cajas.S1!.caja2, '100.00');
    const token = cajero2();
    aceptada = await cobrarLomo(ctx, A(), { turnoId, token });
    rechazada = await cobrarLomo(ctx, A(), { turnoId, token });
    tardia = await cobrarLomo(ctx, A(), { turnoId, token });
    xInicial = await fijo(turnoId);
    expect(xInicial.ventas).toMatchObject({ total: '84.00', cantidad: 3 });

    ctx.pse.reglas.rechazarNumero(numeroDe(rechazada), {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    await procesar(ctx, A().id, aceptada.comprobanteId);
    await procesar(ctx, A().id, rechazada.comprobanteId);
    expect((await comprobanteFila(aceptada.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await comprobanteFila(rechazada.comprobanteId)).estado).toBe('RECHAZADO');
    expect(await fijo(turnoId)).toEqual(xInicial);

    // "Emitir otro": una factura nueva con el mismo importe; no es dinero nuevo.
    const reemision = await escribir(
      ctx,
      supervisor(),
      'post',
      `/facturacion/comprobantes/${rechazada.comprobanteId}/reemision`,
      { tipo: 'FACTURA', cliente: CLIENTE_RUC },
    );
    exigirEstado(reemision, 201, 'Emitir otro (006, criterio 134)');
    const x = await fijo(turnoId);
    expect(x.ventas).toEqual(xInicial.ventas);
    expect(porTipoConVentas(x)).toEqual(porTipoConVentas(xInicial));
    expect(x.esperado).toEqual(xInicial.esperado);
  });

  it('una anulación o un cambio a factura (nota de crédito sin devolución) tampoco suman a las ventas', async () => {
    await seriesDeNotas(ctx, A());
    const anulada = await cobrarLomo(ctx, A(), { turnoId, token: cajero2() });
    const cambiada = await cobrarLomo(ctx, A(), { turnoId, token: cajero2() });
    const antes = await fijo(turnoId);
    await procesar(ctx, A().id, anulada.comprobanteId);
    await procesar(ctx, A().id, cambiada.comprobanteId);
    exigirEstado(
      await escribir(ctx, supervisor(), 'post', '/notas-credito', {
        id: randomUUID(),
        comprobanteId: anulada.comprobanteId,
        tipo: 'ANULACION',
        motivo: 'Venta mal digitada',
        total: '28.00',
      }),
      201,
      'Anulación (006, criterio 143)',
    );
    exigirEstado(
      await escribir(ctx, supervisor(), 'post', '/notas-credito', {
        id: randomUUID(),
        comprobanteId: cambiada.comprobanteId,
        tipo: 'CAMBIO_A_FACTURA',
        motivo: 'El cliente pide factura',
        total: '28.00',
        cliente: CLIENTE_RUC,
      }),
      201,
      'Cambio de boleta por factura (006, criterio 151)',
    );
    const despues = await fijo(turnoId);
    // Ni la nota, ni la factura del cambio, ni la reemisión suman a las ventas.
    expect(despues.ventas).toMatchObject({ cantidad: antes.ventas.cantidad });
    expect(despues.ventas.total).toBe(antes.ventas.total);
    expect(despues.esperado).toEqual(antes.esperado);
  });

  it('la Z de un turno cerrado no cambia cuando la respuesta del PSE llega después del cierre', async () => {
    const x = await reporte(turnoId);
    const res = await cerrarTurnoCrudo(
      ctx,
      cajero2(),
      turnoId,
      conteo(Object.fromEntries(x.esperado.map((e) => [e.medio, e.monto]))),
    );
    exigirEstado(res, 200, 'Cerrar el turno (006, criterio 31)');
    const z = await fijo(turnoId);
    expect(z.ventas.cantidad).toBe(x.ventas.cantidad);
    // Llega la respuesta de la boleta que quedaba por enviar, ya cerrada la Z.
    ctx.reloj.avanzar(60_000);
    await procesar(ctx, A().id, tardia.comprobanteId);
    expect((await comprobanteFila(tardia.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await fijo(turnoId)).toEqual(z);
    // La barrida y los reintentos tampoco la cambian.
    await ctx.barrido.barrerAhora();
    expect(await fijo(turnoId)).toEqual(z);
  });
});
