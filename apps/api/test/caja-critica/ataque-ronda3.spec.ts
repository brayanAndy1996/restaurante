// spec: 006-caja-cobro (pruebas protegidas)
//
// Ataque adversarial, ronda 3: una falla reproducible convertida en pruebas, a partir de la especificación (criterios
// 14, 45a, 52 y la decisión del criterio 90 tras la ronda 3).
// - H1 (media) · una anulación (o unión o cambio) que dejaría un descuento por PORCENTAJE (de ítem o de cuenta) con
//   monto igual o mayor que su base nueva (neto 0.00 por el redondeo, por ejemplo 99.99 % sobre una base menor de
//   S/ 50.00) responde 422 DESCUENTO_INVALIDO sin anular, sin consumir la clave y sin auditoría de la anulación,
//   como el de MONTO del criterio 45a; nunca se emite una línea descontada al 100 % que no sea gratuita. Un
//   porcentaje que sí cabe se recalcula sobre la base nueva y la anulación se acepta.
//   N1: Lomo × 2 (28.00 c/u) y Gaseosa; 99.99 % al Lomo; cobro ITEMS de la Gaseosa; anular 1 Lomo.
//   N2: igual, sin cobros previos. N3: 99.99 % por cuenta sobre Lomo × 2 sin más ítems.
//
// Hoy falla así: la anulación responde 201 y deja la cuenta con el Lomo en neto 0.00 (saldo 0.00 y orden ABIERTA).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  autorizar,
  cerrarAdmin,
  cobrar,
  comprobantesDeLaOrden,
  crearEscenario,
  cuentaCon,
  cuentaDe,
  escribir,
  esperarError,
  estadoDeOrden,
  exigirEstado,
  filas,
  versionDe,
  yape,
  type AppP5,
  type Cuenta,
  type Escenario,
  type Libre,
} from './fabrica-caja';
import { filasAuditoria } from '../acceso/fabrica-equipos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
let turnoId: string;
const A = () => esc.A;
const sup = () => A().token.supervisor!;
const cajero = () => A().token.cajero!;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
  const cajas = await A().cajas();
  turnoId = await abrirTurno(ctx, cajero(), cajas.S1!.caja1, '0.00');
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

const MENSAJE = 'Quita o vuelve a pedir el descuento antes de anular';

const descuento = (
  cuenta: Pick<Cuenta, 'ordenId'>,
  itemId: string | null,
  tipo: 'PORCENTAJE' | 'MONTO',
  valor: string,
) =>
  escribir(ctx, sup(), 'post', `/cuentas/${cuenta.ordenId}/descuentos`, {
    id: randomUUID(),
    itemId,
    tipo,
    valor,
    motivo: 'Cliente frecuente',
  });

const anularItem = (
  token: string,
  cuenta: Pick<Cuenta, 'ordenId'>,
  itemId: string,
  cantidad: number,
  autorizacion?: string,
) =>
  escribir(
    ctx,
    token,
    'post',
    `/ordenes/${cuenta.ordenId}/items/${itemId}/anulaciones`,
    { id: randomUUID(), cantidad, motivo: 'Error de toma', destinoStock: 'VUELVE' },
    autorizacion ? { 'X-Autorizacion': autorizacion } : {},
  );

const vigentes = async (ordenId: string, itemId: string): Promise<number> =>
  Number(
    (
      await filas(
        'SELECT cantidad - cantidad_anulada AS v FROM item WHERE id = $1 AND orden_id = $2',
        [itemId, ordenId],
      )
    )[0]?.v,
  );

/** La vista de la cuenta (para compararla antes y después). */
const vista = async (ordenId: string): Promise<Libre> => cuentaDe(ctx, cajero(), ordenId);

/**
 * Intenta anular con la autorización de supervisor atada y exige el 422 de 45a: sin anular, sin cambiar la versión ni
 * la cuenta, sin auditoría de la anulación y sin consumir la clave (que luego sirve para otra anulación que sí cabe).
 */
async function exigirAnulacionRechazada(
  cuenta: Cuenta,
  itemId: string,
  cantidad: number,
): Promise<{ autorizacionId: string }> {
  const auth = await autorizar(ctx, cajero(), A().personas.supervisor!.pin, 'ANULAR_ITEM_ENVIADO');
  const antes = await vista(cuenta.ordenId);
  const version = await versionDe(cuenta.ordenId);
  const vigentesAntes = await vigentes(cuenta.ordenId, itemId);
  const auditoria = (await filasAuditoria(A().id, 'anular_item')).length;
  const res = await anularItem(cajero(), cuenta, itemId, cantidad, auth.autorizacionId);
  esperarError(res, 422, 'DESCUENTO_INVALIDO');
  expect(res.body.campos).toEqual([{ campo: 'descuento', mensaje: MENSAJE }]);
  expect(res.body.mensaje).toBe(MENSAJE);
  expect(await vigentes(cuenta.ordenId, itemId)).toBe(vigentesAntes);
  expect(await versionDe(cuenta.ordenId)).toBe(version);
  expect((await filasAuditoria(A().id, 'anular_item')).length).toBe(auditoria);
  expect(await vista(cuenta.ordenId)).toEqual(antes);
  expect(await estadoDeOrden(cuenta.ordenId)).toBe('ABIERTA');
  const [a] = await filas('SELECT usada_en FROM autorizacion WHERE id = $1', [auth.autorizacionId]);
  expect(a!.usada_en, 'la clave de supervisor no se consume').toBeNull();
  return auth;
}

/** Ninguna línea de ningún comprobante de la orden quedó con neto 0.00 y descuento sin ser gratuita. */
async function sinLineaAlCienPorCientoNoGratuita(ordenId: string): Promise<void> {
  const lineas = await filas(
    `SELECT cl.*
       FROM comprobante_linea cl JOIN comprobante k ON k.id = cl.comprobante_id
      WHERE k.orden_id = $1`,
    [ordenId],
  );
  for (const l of lineas) {
    const esCien = Number(l.neto) === 0 && Number(l.descuento) > 0;
    expect(esCien && !l.gratuita, `línea ${JSON.stringify(l)}`).toBe(false);
  }
}

describe('H1 · el descuento por porcentaje que quedaría sin base se rechaza como el de monto (criterios 14, 45a y 90)', () => {
  it('N1: 99.99 % al Lomo, la Gaseosa ya cobrada y anular 1 Lomo responde 422 DESCUENTO_INVALIDO y la cuenta sigue igual', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 2],
      ['gaseosa', 1],
    ]);
    exigirEstado(
      await descuento(cuenta, cuenta.item.lomo!, 'PORCENTAJE', '99.99'),
      201,
      '99.99 % al Lomo (base 56.00, descuento 55.99, neto 0.01)',
    );
    await cobrar(ctx, cajero(), cuenta, {
      turnoId,
      total: '9.00',
      pagos: [yape('9.00', 'Y-H1-N1')],
      parte: { tipo: 'ITEMS', items: [{ itemId: cuenta.item.gaseosa!, cantidad: 1 }] },
    });
    await exigirAnulacionRechazada(cuenta, cuenta.item.lomo!, 1);

    // La cuenta sigue con el Lomo × 2 y el descuento tal como lo autorizó el supervisor.
    const v = await vista(cuenta.ordenId);
    const lomo = v.lineas.find((l: Libre) => l.itemId === cuenta.item.lomo);
    expect(lomo).toMatchObject({ cantidad: 2, neto: '0.01', descuento: { monto: '55.99' } });
    const [d] = await filas('SELECT valor::text, quitado_en FROM descuento WHERE orden_id = $1', [
      cuenta.ordenId,
    ]);
    expect(d).toMatchObject({ valor: '99.99', quitado_en: null });
    // Nunca queda una cuenta con saldo 0.00 y la orden abierta por una línea de neto 0.00.
    expect(v.saldo).toBe('0.01');
  });

  it('N2: lo mismo sin cobros previos responde 422 y no anula', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['lomo', 2]]);
    exigirEstado(
      await descuento(cuenta, cuenta.item.lomo!, 'PORCENTAJE', '99.99'),
      201,
      '99.99 % al Lomo',
    );
    const auth = await exigirAnulacionRechazada(cuenta, cuenta.item.lomo!, 1);
    expect(await vigentes(cuenta.ordenId, cuenta.item.lomo!)).toBe(2);
    expect(await comprobantesDeLaOrden(cuenta.ordenId)).toEqual([]);
    await sinLineaAlCienPorCientoNoGratuita(cuenta.ordenId);
    // La misma clave sirve para anular las dos unidades (la línea sale con su descuento: no queda ninguno que revalidar).
    exigirEstado(
      await anularItem(cajero(), cuenta, cuenta.item.lomo!, 2, auth.autorizacionId),
      201,
      'Anular el ítem completo lo saca de la cuenta con su descuento (criterio 45a)',
    );
  });

  it('N3: un descuento de cuenta del 99.99 % sobre Lomo × 2 y anular 1 Lomo responde 422', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['lomo', 2]]);
    exigirEstado(
      await descuento(cuenta, null, 'PORCENTAJE', '99.99'),
      201,
      '99.99 % por cuenta (base 56.00)',
    );
    await exigirAnulacionRechazada(cuenta, cuenta.item.lomo!, 1);
    const v = await vista(cuenta.ordenId);
    expect(v.descuentoCuenta).toMatchObject({ tipo: 'PORCENTAJE', valor: '99.99' });
    expect(v.totales).toMatchObject({ total: '0.01' });
    expect(await comprobantesDeLaOrden(cuenta.ordenId)).toEqual([]);
  });

  it('control: un 10 % al Lomo y anular 1 unidad se acepta y el descuento se recalcula sobre la base nueva', async () => {
    const cuenta = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 2],
      ['gaseosa', 1],
    ]);
    exigirEstado(
      await descuento(cuenta, cuenta.item.lomo!, 'PORCENTAJE', '10.00'),
      201,
      '10 % al Lomo (5.60)',
    );
    exigirEstado(await anularItem(sup(), cuenta, cuenta.item.lomo!, 1), 201, 'Anular 1 Lomo');
    const v = await api(ctx, cajero(), 'get', `/cuentas/${cuenta.ordenId}`);
    exigirEstado(v, 200, 'GET /cuentas/:ordenId');
    expect(v.body.lineas.find((l: Libre) => l.itemId === cuenta.item.lomo)).toMatchObject({
      cantidad: 1,
      neto: '25.20',
      descuento: { monto: '2.80' },
    });
    const [d] = await filas('SELECT valor::text, quitado_en FROM descuento WHERE orden_id = $1', [
      cuenta.ordenId,
    ]);
    expect(d).toMatchObject({ valor: '10.00', quitado_en: null });
  });
});
