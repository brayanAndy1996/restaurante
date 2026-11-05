// Historia 006 · caja, cobro y comprobantes, grupo C3 (T12) · pruebas del desarrollador (no protegidas) de los
// descuentos y las cortesías: lo que `caja-critica/descuentos-cortesias.spec.ts` no recorre. El criterio 45a (decisión
// del usuario del 2026-11-04: un cambio que dejaría un descuento por MONTO mayor o igual que su base se rechaza con 422
// `DESCUENTO_INVALIDO` sin anular, sin consumir la clave y sin auditoría; el descuento nunca se recorta ni se quita
// solo; un porcentaje se recalcula), el `CUENTA_EN_COBRO` sin pasar por el cobro (grupo C4), el objetivo de
// `POST /autorizaciones`, `GET /cuentas` con `ETag` y la forma de `GET /cuentas/:ordenId`.
import { randomUUID } from 'node:crypto';
import { cuentaRespuestaSchema, cuentaResumenSchema } from '@restaurante/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { filasAuditoria } from '../acceso/fabrica-equipos';
import { conActor } from '../aislamiento/fabrica';
import {
  admin,
  api,
  arrancarCaja,
  autorizar,
  cerrarAdmin,
  crearEscenario,
  cuentaC,
  cuentaCon,
  escribir,
  esperarError,
  exigirEstado,
  filas,
  versionDe,
  type AppP5,
  type Cuenta,
  type Escenario,
  type Libre,
  type Res,
} from '../caja-critica/fabrica-caja';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja();
  esc = await crearEscenario(ctx);
  await A().cajas();
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

const sup = () => A().token.supervisor!;
const pin = () => A().personas.supervisor!.pin;

const descuento = (
  token: string,
  cuenta: Pick<Cuenta, 'ordenId'>,
  itemId: string | null,
  tipo: 'PORCENTAJE' | 'MONTO',
  valor: string,
  autorizacion?: string,
): Promise<Res> =>
  escribir(
    ctx,
    token,
    'post',
    `/cuentas/${cuenta.ordenId}/descuentos`,
    { id: randomUUID(), itemId, tipo, valor, motivo: 'Cliente frecuente' },
    autorizacion ? { 'X-Autorizacion': autorizacion } : {},
  );

const cortesia = (
  cuenta: Pick<Cuenta, 'ordenId'>,
  itemId: string,
  cantidad: number,
): Promise<Res> =>
  escribir(ctx, sup(), 'post', `/cuentas/${cuenta.ordenId}/cortesias`, {
    id: randomUUID(),
    itemId,
    cantidad,
    motivo: 'Atención de la casa',
  });

const anularItem = (
  token: string,
  cuenta: Cuenta,
  itemId: string,
  cantidad: number,
  autorizacion?: string,
): Promise<Res> =>
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

describe('criterio 45a · un cambio que la cuenta no admite con el descuento', () => {
  it('anular unidades que dejarían un descuento por monto de ítem mayor o igual que su base: 422 sin anular ni consumir la clave', async () => {
    const cuenta = await cuentaC(ctx, A());
    // 30.00 sobre el Lomo (2 × 28.00 = 56.00): cabe; con 1 sola unidad (28.00) ya no.
    exigirEstado(
      await descuento(sup(), cuenta, cuenta.item.lomo!, 'MONTO', '30.00'),
      201,
      'Descuento de S/ 30.00',
    );
    const cajero = A().token.cajero!;
    const auth = await autorizar(ctx, cajero, pin(), 'ANULAR_ITEM_ENVIADO');
    const version = await versionDe(cuenta.ordenId);
    const antesAuditoria = (await filasAuditoria(A().id, 'anular_item')).length;
    const res = await anularItem(cajero, cuenta, cuenta.item.lomo!, 1, auth.autorizacionId);
    esperarError(res, 422, 'DESCUENTO_INVALIDO');
    expect(res.body.campos).toEqual([
      { campo: 'descuento', mensaje: 'Quita o vuelve a pedir el descuento antes de anular' },
    ]);
    expect(res.body.mensaje).toBe('Quita o vuelve a pedir el descuento antes de anular');
    // Nada cambió: la cantidad, la versión, la auditoría, el descuento y la clave.
    expect(await vigentes(cuenta.ordenId, cuenta.item.lomo!)).toBe(2);
    expect(await versionDe(cuenta.ordenId)).toBe(version);
    expect((await filasAuditoria(A().id, 'anular_item')).length).toBe(antesAuditoria);
    const [d] = await filas('SELECT valor::text, quitado_en FROM descuento WHERE orden_id = $1', [
      cuenta.ordenId,
    ]);
    expect(d).toMatchObject({ valor: '30.00', quitado_en: null });
    const [a] = await filas('SELECT usada_en FROM autorizacion WHERE id = $1', [
      auth.autorizacionId,
    ]);
    expect(a!.usada_en).toBeNull();
    // La misma clave sirve para otra anulación que sí cabe.
    exigirEstado(
      await anularItem(cajero, cuenta, cuenta.item.mandarina!, 1, auth.autorizacionId),
      201,
      'Anular la Mandarina con la misma clave',
    );
  });

  it('un descuento por monto de la cuenta que dejaría de caber también rechaza la anulación', async () => {
    const cuenta = await cuentaC(ctx, A());
    // Base de la cuenta: 68.20 sin ICBPER. Con S/ 60.00 cabe; sin la Gaseosa (59.20) ya no.
    exigirEstado(
      await descuento(sup(), cuenta, null, 'MONTO', '60.00'),
      201,
      'Descuento por cuenta de S/ 60.00',
    );
    const res = await anularItem(sup(), cuenta, cuenta.item.gaseosa!, 1);
    esperarError(res, 422, 'DESCUENTO_INVALIDO');
    expect(res.body.campos).toEqual([
      { campo: 'descuento', mensaje: 'Quita o vuelve a pedir el descuento antes de anular' },
    ]);
    expect(await vigentes(cuenta.ordenId, cuenta.item.gaseosa!)).toBe(1);
    // Una anulación que sí cabe (la Mandarina, 3.00: 65.20) pasa y el descuento sigue intacto.
    exigirEstado(
      await anularItem(sup(), cuenta, cuenta.item.mandarina!, 1),
      201,
      'Anular la Mandarina',
    );
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    expect(vista.body.descuentoCuenta).toMatchObject({
      tipo: 'MONTO',
      valor: '60.00',
      monto: '60.00',
    });
    expect(vista.body.totales).toMatchObject({ descuentos: '60.00', total: '6.20' });
  });

  it('un descuento por porcentaje se recalcula sobre la base nueva', async () => {
    const cuenta = await cuentaC(ctx, A());
    exigirEstado(
      await descuento(sup(), cuenta, cuenta.item.lomo!, 'PORCENTAJE', '10.00'),
      201,
      'Descuento del 10 %',
    );
    exigirEstado(await anularItem(sup(), cuenta, cuenta.item.lomo!, 1), 201, 'Anular un Lomo');
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    const lomo = vista.body.lineas.find((l: Libre) => l.itemId === cuenta.item.lomo);
    expect(lomo).toMatchObject({
      cantidad: 1,
      neto: '25.20',
      descuento: { valor: '10.00', monto: '2.80' },
    });
  });

  it('anular del todo el ítem con descuento lo saca de la cuenta: el descuento queda guardado y ya no cuenta', async () => {
    const cuenta = await cuentaC(ctx, A());
    exigirEstado(
      await descuento(sup(), cuenta, cuenta.item.lomo!, 'MONTO', '30.00'),
      201,
      'Descuento de S/ 30.00',
    );
    exigirEstado(
      await anularItem(sup(), cuenta, cuenta.item.lomo!, 2),
      201,
      'Anular los dos Lomos',
    );
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    expect(vista.status).toBe(200);
    expect(vista.body.lineas.map((l: Libre) => l.itemId)).not.toContain(cuenta.item.lomo);
    expect(vista.body.totales.descuentos).toBe('0.00');
  });

  it('una cortesía que pasaría de las unidades que quedan rechaza la anulación (409); anularlas todas sí se puede', async () => {
    const cuenta = await cuentaC(ctx, A());
    exigirEstado(await cortesia(cuenta, cuenta.item.lomo!, 2), 201, 'Cortesía de los dos Lomos');
    esperarError(await anularItem(sup(), cuenta, cuenta.item.lomo!, 1), 409, 'CONFLICTO');
    expect(await vigentes(cuenta.ordenId, cuenta.item.lomo!)).toBe(2);
    exigirEstado(
      await anularItem(sup(), cuenta, cuenta.item.lomo!, 2),
      201,
      'Anular los dos Lomos',
    );
  });

  it('una unión que deja sin base el descuento de cuenta de la orden absorbida: 422 sin unir', async () => {
    const principal = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const absorbida = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const creado = await descuento(sup(), absorbida, null, 'PORCENTAJE', '10.00');
    exigirEstado(creado, 201, 'Descuento por cuenta de la absorbida');
    const res = await escribir(ctx, sup(), 'post', `/ordenes/${principal.ordenId}/union`, {
      mesaIds: [absorbida.mesaId],
    });
    esperarError(res, 422, 'DESCUENTO_INVALIDO');
    expect(res.body.campos).toEqual([
      { campo: 'descuento', mensaje: 'Quita o vuelve a pedir el descuento antes de unir' },
    ]);
    const [o] = await filas('SELECT estado FROM orden WHERE id = $1', [absorbida.ordenId]);
    expect(o!.estado).toBe('ABIERTA');
    // Quitado el descuento (sin clave), la unión pasa.
    exigirEstado(
      await api(ctx, sup(), 'delete', `/cuentas/${absorbida.ordenId}/descuentos/${creado.body.id}`),
      204,
      'Quitar el descuento',
    );
    exigirEstado(
      await escribir(ctx, sup(), 'post', `/ordenes/${principal.ordenId}/union`, {
        mesaIds: [absorbida.mesaId],
      }),
      200,
      'Unir',
    );
  });

  it('los descuentos y cortesías de ítem viajan con su ítem al unir', async () => {
    const principal = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const absorbida = await cuentaCon(ctx, A(), 'S1', [
      ['lomo', 1],
      ['gaseosa', 1],
    ]);
    exigirEstado(
      await descuento(sup(), absorbida, absorbida.item.lomo!, 'PORCENTAJE', '10.00'),
      201,
      'Descuento',
    );
    exigirEstado(await cortesia(absorbida, absorbida.item.gaseosa!, 1), 201, 'Cortesía');
    exigirEstado(
      await escribir(ctx, sup(), 'post', `/ordenes/${principal.ordenId}/union`, {
        mesaIds: [absorbida.mesaId],
      }),
      200,
      'Unir',
    );
    const vista = await api(ctx, A().token.cajero, 'get', `/cuentas/${principal.ordenId}`);
    expect(vista.body.lineas).toHaveLength(3);
    expect(
      vista.body.lineas.find((l: Libre) => l.itemId === absorbida.item.lomo).descuento,
    ).toMatchObject({
      monto: '2.80',
    });
    expect(vista.body.cortesias).toHaveLength(1);
  });

  it('un descuento de ítem o una cortesía nuevos que dejarían sin base el descuento de cuenta: 422 sin escribir', async () => {
    const cuenta = await cuentaC(ctx, A());
    exigirEstado(
      await descuento(sup(), cuenta, null, 'MONTO', '60.00'),
      201,
      'Descuento por cuenta',
    );
    // Con S/ 10.00 al Lomo la base de la cuenta baja a 58.20 y los 60.00 ya no caben.
    esperarError(
      await descuento(sup(), cuenta, cuenta.item.lomo!, 'MONTO', '10.00'),
      422,
      'DESCUENTO_INVALIDO',
    );
    // La cortesía de la Gaseosa (9.00) baja la base a 59.20.
    esperarError(await cortesia(cuenta, cuenta.item.gaseosa!, 1), 422, 'DESCUENTO_INVALIDO');
    expect(
      (
        await filas('SELECT 1 FROM descuento WHERE orden_id = $1 AND item_id IS NOT NULL', [
          cuenta.ordenId,
        ])
      ).length,
    ).toBe(0);
    expect(
      (await filas('SELECT 1 FROM cortesia WHERE orden_id = $1', [cuenta.ordenId])).length,
    ).toBe(0);
  });
});

describe('criterio 45 · con cobros', () => {
  it('con algún cobro, aplicar o quitar un descuento o una cortesía responde 409 CUENTA_EN_COBRO', async () => {
    const cuenta = await cuentaC(ctx, A());
    const previo = await descuento(sup(), cuenta, cuenta.item.gaseosa!, 'PORCENTAJE', '10.00');
    exigirEstado(previo, 201, 'Descuento previo');
    const cortesiaPrevia = await cortesia(cuenta, cuenta.item.mandarina!, 1);
    exigirEstado(cortesiaPrevia, 201, 'Cortesía previa');
    // El cobro llega en el grupo C4: aquí se marca la orden como cobrada en parte.
    const cliente = await admin();
    await conActor(cliente, () =>
      cliente.query('UPDATE orden SET cobros = 1 WHERE id = $1', [cuenta.ordenId]),
    );
    esperarError(
      await descuento(sup(), cuenta, cuenta.item.lomo!, 'PORCENTAJE', '10.00'),
      409,
      'CUENTA_EN_COBRO',
    );
    esperarError(await cortesia(cuenta, cuenta.item.lomo!, 1), 409, 'CUENTA_EN_COBRO');
    esperarError(
      await api(ctx, sup(), 'delete', `/cuentas/${cuenta.ordenId}/descuentos/${previo.body.id}`),
      409,
      'CUENTA_EN_COBRO',
    );
    esperarError(
      await api(
        ctx,
        sup(),
        'delete',
        `/cuentas/${cuenta.ordenId}/cortesias/${cortesiaPrevia.body.id}`,
      ),
      409,
      'CUENTA_EN_COBRO',
    );
  });
});

describe('réplica por el id del descuento y de la cortesía', () => {
  it('el mismo id con el mismo cuerpo y otra clave de idempotencia devuelve lo hecho; con otro valor, 422', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cuerpo = {
      id: randomUUID(),
      itemId: cuenta.item.lomo,
      tipo: 'PORCENTAJE',
      valor: '10.00',
      motivo: 'Cliente frecuente',
    };
    const ruta = `/cuentas/${cuenta.ordenId}/descuentos`;
    const primera = await escribir(ctx, sup(), 'post', ruta, cuerpo);
    exigirEstado(primera, 201, 'Descuento');
    const version = await versionDe(cuenta.ordenId);
    const otraClave = await escribir(ctx, sup(), 'post', ruta, cuerpo);
    exigirEstado(otraClave, 201, 'Réplica con otra clave');
    expect(otraClave.body).toEqual(primera.body);
    expect(await versionDe(cuenta.ordenId)).toBe(version);
    esperarError(
      await escribir(ctx, sup(), 'post', ruta, { ...cuerpo, valor: '20.00' }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    // El mismo id en otra orden tampoco es una réplica.
    const otra = await cuentaC(ctx, A());
    esperarError(
      await escribir(ctx, sup(), 'post', `/cuentas/${otra.ordenId}/descuentos`, {
        ...cuerpo,
        itemId: otra.item.lomo,
      }),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
  });
});

describe('POST /autorizaciones con objetivo', () => {
  it('guarda y devuelve el objetivo normalizado (ids en minúsculas y valor con 2 decimales)', async () => {
    const cuenta = await cuentaC(ctx, A());
    const res = await api(ctx, A().token.cajero, 'post', '/autorizaciones', {
      accion: 'APLICAR_DESCUENTO',
      motivo: 'Autoriza el supervisor',
      pin: pin(),
      objetivo: {
        tipo: 'DESCUENTO',
        ordenId: cuenta.ordenId.toUpperCase(),
        itemId: cuenta.item.lomo!.toUpperCase(),
        descuento: { tipo: 'PORCENTAJE', valor: '10' },
      },
    });
    exigirEstado(res, 201, 'Autorización con objetivo');
    expect(res.body.objetivo).toEqual({
      tipo: 'DESCUENTO',
      ordenId: cuenta.ordenId,
      itemId: cuenta.item.lomo,
      descuento: { tipo: 'PORCENTAJE', valor: '10.00' },
    });
    const [fila] = await filas('SELECT objetivo FROM autorizacion WHERE id = $1', [
      res.body.autorizacionId,
    ]);
    expect(fila!.objetivo).toEqual(res.body.objetivo);
  });

  it('un objetivo de otra acción responde 400 sin crear la autorización; sin objetivo la clave sigue siendo la de 002', async () => {
    const cuenta = await cuentaC(ctx, A());
    const mala = await api(ctx, A().token.cajero, 'post', '/autorizaciones', {
      accion: 'ANULAR_ITEM_ENVIADO',
      motivo: 'Autoriza el supervisor',
      pin: pin(),
      objetivo: {
        tipo: 'CORTESIA',
        ordenId: cuenta.ordenId,
        itemId: cuenta.item.lomo,
        cantidad: 1,
      },
    });
    esperarError(mala, 400, 'DATOS_INVALIDOS');
    const sinObjetivo = await autorizar(ctx, A().token.cajero!, pin(), 'APLICAR_DESCUENTO');
    const [fila] = await filas('SELECT objetivo FROM autorizacion WHERE id = $1', [
      sinObjetivo.autorizacionId,
    ]);
    expect(fila!.objetivo).toBeNull();
  });
});

describe('criterios 36 y 37 · la cuenta', () => {
  it('GET /cuentas/:ordenId responde la forma del contrato con sus descuentos, cortesías y parámetros', async () => {
    const cuenta = await cuentaC(ctx, A());
    exigirEstado(
      await descuento(sup(), cuenta, cuenta.item.lomo!, 'PORCENTAJE', '10.00'),
      201,
      'Descuento',
    );
    exigirEstado(await cortesia(cuenta, cuenta.item.gaseosa!, 1), 201, 'Cortesía');
    const res = await api(ctx, A().token.cajero, 'get', `/cuentas/${cuenta.ordenId}`);
    exigirEstado(res, 200, 'La cuenta');
    const vista = cuentaRespuestaSchema.parse(res.body);
    expect(vista).toMatchObject({
      ordenId: cuenta.ordenId,
      tipo: 'MESA',
      estado: 'ABIERTA',
      cobrado: '0.00',
      saldo: '54.60',
      modo: null,
      cobros: [],
      parametros: {
        tasaIgv: '18.00',
        montoIcbper: '0.50',
        regimen: 'GENERAL',
        tiposPermitidos: ['BOLETA', 'FACTURA'],
      },
    });
    expect(vista.totales.total).toBe('54.60');
    expect(vista.cortesias).toHaveLength(1);
    expect(vista.mesas).toEqual([{ id: cuenta.mesaId, nombre: expect.any(String) }]);
    expect(vista.mozo).toMatchObject({ id: A().personas.mozo!.id });
  });

  it('una orden de otra sucursal o de otra empresa responde 404', async () => {
    const cuenta = await cuentaC(ctx, A());
    expect((await api(ctx, esc.B.token.cajero, 'get', `/cuentas/${cuenta.ordenId}`)).status).toBe(
      404,
    );
    expect((await api(ctx, A().token.cajero, 'get', `/cuentas/${randomUUID()}`)).status).toBe(404);
  });

  it('GET /cuentas lista las órdenes abiertas de la más antigua a la más nueva, con ETag y 304', async () => {
    const primera = await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    // El reloj de las pruebas es manual: sin avanzarlo las dos órdenes se abren en el mismo instante.
    ctx.reloj.avanzar(1_000);
    const segunda = await cuentaCon(ctx, A(), 'S3', [['gaseosa', 2]]);
    const token = A().token.cajeroS3!;
    const res = await api(ctx, token, 'get', '/cuentas');
    exigirEstado(res, 200, 'Por cobrar');
    const lista = cuentaResumenSchema.array().parse(res.body);
    const ids = lista.map((c) => c.ordenId);
    expect(ids.indexOf(primera.ordenId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(primera.ordenId)).toBeLessThan(ids.indexOf(segunda.ordenId));
    expect(lista.find((c) => c.ordenId === segunda.ordenId)).toMatchObject({
      total: '18.00',
      saldo: '18.00',
      estado: 'ABIERTA',
      modo: null,
    });
    const etag = res.headers.etag as string;
    expect(etag).toBeTruthy();
    const igual = await api(ctx, token, 'get', '/cuentas', undefined, { 'If-None-Match': etag });
    expect(igual.status).toBe(304);
    exigirEstado(
      await descuento(A().token.supervisorS3!, segunda, segunda.item.gaseosa!, 'MONTO', '2.00'),
      201,
      'Descuento',
    );
    const cambio = await api(ctx, token, 'get', '/cuentas', undefined, { 'If-None-Match': etag });
    expect(cambio.status).toBe(200);
  });
});
