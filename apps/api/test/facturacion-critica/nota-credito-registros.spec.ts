// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P8 · Auditoría, cuota e inmutabilidad de las notas de crédito (ruta crítica), criterios 154 a 156:
// - 154: `emitir_nota_credito` deja exactamente una fila por nota, con el actor, el autorizador y la autorización si hubo
//   clave, y en `detalle` la nota, el original, las líneas, la devolución y la factura de un cambio; con clave queda además
//   la fila de consumo de 002 (`EMITIR_NOTA_CREDITO`); la réplica y los rechazos no dejan filas;
// - 155: cada comprobante emitido cuenta una vez en el consumo del mes: la nota, la factura de un cambio y cada reemisión; si
//   la operación se revierte, el conteo también;
// - 156: ni la nota, ni el original, ni sus líneas se borran ni cambian de montos (la base lo rechaza con 42501 para
//   `restaurante_api`); la nota no reabre la orden ni cambia lo que la orden considera cobrado.
// Hoy falla por "No implementado": `POST /notas-credito` y el worker lanzan `Error('No implementado')` y las series de notas de
// crédito todavía no existen.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { filasAuditoria } from '../acceso/fabrica-equipos';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import {
  api,
  cerrarAdmin,
  crearEscenario,
  exigir,
  filas,
  CLIENTE_RUC,
  type Escenario,
} from '../caja-critica/fabrica-caja';
import { abrirCliente } from '../utilidades';
import {
  arrancarNotas,
  autorizarNota,
  consumoDeComprobantes,
  cuerpoNota,
  efectivo,
  emitirAceptado,
  emitirNota,
  fallarElTicketDeLaNota,
  notaCrudo,
  notasDelOriginal,
  objetivoNota,
  prepararNotas,
  type AppNotas,
  type Libre,
} from './fabrica-notas';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppNotas;
let esc: Escenario;
let apiSql: Client;
const A = () => esc.A;
const sup = () => A().token.supervisor!;

beforeAll(async () => {
  ctx = await arrancarNotas();
  esc = await crearEscenario(ctx);
  apiSql = await abrirCliente('api');
});
afterAll(async () => {
  await apiSql?.end();
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

const auditoriaDeNota = (notaId: string) =>
  filas(
    `SELECT * FROM auditoria WHERE empresa_id = $1 AND accion = 'emitir_nota_credito' AND detalle->>'notaId' = $2`,
    [A().id, notaId],
  );

const totalDeFilasDeAuditoria = async (): Promise<number> =>
  Number(
    (await filas('SELECT count(*)::text AS n FROM auditoria WHERE empresa_id = $1', [A().id]))[0]!
      .n,
  );

// ------------------------------------------------------------------------------------------------
describe('criterio 154 · auditoría', () => {
  it('una devolución deja exactamente una fila con el actor, la nota, el original, las líneas y la devolución', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    const nota = res.nota as Libre;
    const filasDeNota = await auditoriaDeNota(nota.id as string);
    expect(filasDeNota).toHaveLength(1);
    const fila = filasDeNota[0]!;
    expect(fila).toMatchObject({
      accion: 'emitir_nota_credito',
      entidad: 'comprobante',
      entidad_id: nota.id,
      actor_usuario_id: A().personas.supervisor!.id,
      autorizado_por_id: null,
      autorizacion_id: null,
      sucursal_id: A().S1,
    });
    expect(fila.detalle).toMatchObject({
      notaId: nota.id,
      numero: nota.numero,
      tipoNota: 'DEVOLUCION',
      original: { id: o.comprobanteId, numero: o.numero },
      total: '28.00',
      lineas: [
        { posicionOrigen: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1, neto: '28.00' },
      ],
      devolucion: {
        turnoId: o.turnoId,
        pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
        redondeo: '0.00',
      },
      factura: null,
    });
  });

  it('una anulación deja devolucion null y todas las líneas; un cambio a factura deja la factura en el detalle', async () => {
    const anulada = await boleta();
    const a = await emitirNota(ctx, sup(), {
      comprobanteId: anulada.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const [filaA] = await auditoriaDeNota((a.nota as Libre).id as string);
    expect(filaA!.detalle).toMatchObject({
      tipoNota: 'ANULACION',
      total: '69.20',
      devolucion: null,
      factura: null,
    });
    expect(filaA!.detalle.lineas).toHaveLength(4);

    const cambiada = await boleta();
    const c = await emitirNota(ctx, sup(), {
      comprobanteId: cambiada.comprobanteId,
      tipo: 'CAMBIO_A_FACTURA',
      total: '69.20',
      cliente: CLIENTE_RUC,
    });
    const filasDeCambio = await auditoriaDeNota((c.nota as Libre).id as string);
    expect(filasDeCambio).toHaveLength(1);
    expect(filasDeCambio[0]!.detalle).toMatchObject({
      tipoNota: 'CAMBIO_A_FACTURA',
      factura: { id: (c.factura as Libre).id, numero: (c.factura as Libre).numero },
    });
  });

  it('con clave queda el autorizador, la autorización y la fila de consumo de 002 (EMITIR_NOTA_CREDITO); el actor es el Cajero', async () => {
    const o = await boleta();
    const clave = await autorizarNota(
      ctx,
      A().token.cajero!,
      A().personas.supervisor!.pin,
      objetivoNota(o.comprobanteId, 'ANULACION', '69.20'),
    );
    const res = await emitirNota(
      ctx,
      A().token.cajero!,
      { comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' },
      { autorizacion: clave.autorizacionId },
    );
    const filasDeNota = await auditoriaDeNota((res.nota as Libre).id as string);
    expect(filasDeNota).toHaveLength(1);
    expect(filasDeNota[0]).toMatchObject({
      actor_usuario_id: A().personas.cajero!.id,
      autorizado_por_id: A().personas.supervisor!.id,
      autorizacion_id: clave.autorizacionId,
    });
    const consumos = (await filasAuditoria(A().id, 'EMITIR_NOTA_CREDITO')).filter((f) =>
      f.texto.includes(clave.autorizacionId),
    );
    expect(consumos.length).toBeGreaterThanOrEqual(1);
  });

  it('la réplica y los rechazos no dejan filas de auditoría', async () => {
    const o = await boleta();
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const primera = await notaCrudo(ctx, sup(), cuerpo);
    expect(primera.status, primera.text).toBe(201);
    const despuesDeLaPrimera = await totalDeFilasDeAuditoria();
    // Réplica por id (otra IK) y por IK.
    expect((await notaCrudo(ctx, sup(), cuerpo)).status).toBe(201);
    expect((await notaCrudo(ctx, sup(), cuerpo, { ik: randomUUID() })).status).toBe(201);
    // Rechazos: el original ya anulado, el total que no coincide, el rol sin permiso y la forma incorrecta.
    await notaCrudo(ctx, sup(), { ...cuerpo, id: randomUUID() });
    await notaCrudo(ctx, sup(), { ...cuerpo, id: randomUUID(), total: '1.00' });
    await notaCrudo(ctx, A().token.mozo!, { ...cuerpo, id: randomUUID() });
    await notaCrudo(ctx, sup(), { ...cuerpo, id: 'no-es-uuid' });
    expect(await totalDeFilasDeAuditoria()).toBe(despuesDeLaPrimera);
    expect(await auditoriaDeNota((primera.body.nota as Libre).id as string)).toHaveLength(1);
  });

  it('una nota que se revierte no deja fila de auditoría', async () => {
    const o = await boleta();
    const antes = await totalDeFilasDeAuditoria();
    const quitar = await fallarElTicketDeLaNota(o.comprobanteId);
    try {
      const res = await notaCrudo(
        ctx,
        sup(),
        cuerpoNota({ comprobanteId: o.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      );
      expect(res.status, res.text).toBeGreaterThanOrEqual(500);
    } finally {
      await quitar();
    }
    expect(await totalDeFilasDeAuditoria()).toBe(antes);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 155 · cuota del plan', () => {
  it('cada nota cuenta una vez y el cambio a factura cuenta dos (la nota y la factura)', async () => {
    const a = await boleta();
    const b = await boleta();
    const antes = await consumoDeComprobantes(A().S1);
    await emitirNota(ctx, sup(), {
      comprobanteId: a.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    expect(await consumoDeComprobantes(A().S1)).toBe(antes + 1);
    await emitirNota(ctx, sup(), {
      comprobanteId: b.comprobanteId,
      tipo: 'CAMBIO_A_FACTURA',
      total: '69.20',
      cliente: CLIENTE_RUC,
    });
    expect(await consumoDeComprobantes(A().S1)).toBe(antes + 3);
  });

  it('la réplica no vuelve a contar y una nota revertida tampoco', async () => {
    const o = await boleta();
    const mala = await boleta();
    const cuerpo = cuerpoNota({
      comprobanteId: o.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const antes = await consumoDeComprobantes(A().S1);
    expect((await notaCrudo(ctx, sup(), cuerpo)).status).toBe(201);
    expect((await notaCrudo(ctx, sup(), cuerpo)).status).toBe(201);
    expect(await consumoDeComprobantes(A().S1)).toBe(antes + 1);
    const quitar = await fallarElTicketDeLaNota(mala.comprobanteId);
    try {
      const res = await notaCrudo(
        ctx,
        sup(),
        cuerpoNota({ comprobanteId: mala.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      );
      expect(res.status, res.text).toBeGreaterThanOrEqual(500);
    } finally {
      await quitar();
    }
    expect(await consumoDeComprobantes(A().S1)).toBe(antes + 1);
  });

  it('cada reemisión de un comprobante rechazado cuenta una vez', async () => {
    const rechazado = await boleta({ aceptado: false });
    ctx.simulador.reglas.rechazarNumero(rechazado.numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    try {
      await ctx.procesar(A().id, rechazado.comprobanteId);
    } finally {
      ctx.simulador.reglas.limpiar();
    }
    const antes = await consumoDeComprobantes(A().S1);
    const reemision = await api(
      ctx,
      sup(),
      'post',
      `/facturacion/comprobantes/${rechazado.comprobanteId}/reemision`,
      { tipo: 'BOLETA' },
      { 'Idempotency-Key': randomUUID() },
    );
    exigir(reemision, 201, 'Emitir otro (006, criterio 134)');
    expect(await consumoDeComprobantes(A().S1)).toBe(antes + 1);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 156 · inmutable', () => {
  it('restaurante_api no puede borrar ni cambiar montos, líneas, vínculos o `simulado` de la nota ni del original, ni tocar sus egresos', async () => {
    const o = await boleta();
    const res = await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
      devolucion: { turnoId: o.turnoId, pagos: [efectivo('28.00')], redondeo: '0.00' },
    });
    const notaId = (res.nota as Libre).id as string;
    const intentos: Array<[string, string]> = [];
    for (const id of [notaId, o.comprobanteId]) {
      intentos.push(
        [`UPDATE del total de ${id}`, `UPDATE comprobante SET total = '1.00' WHERE id = '${id}'`],
        [`UPDATE del IGV de ${id}`, `UPDATE comprobante SET igv = '0.00' WHERE id = '${id}'`],
        [
          `UPDATE del número de ${id}`,
          `UPDATE comprobante SET numero = numero + 1 WHERE id = '${id}'`,
        ],
        [`UPDATE de la serie de ${id}`, `UPDATE comprobante SET serie = 'X999' WHERE id = '${id}'`],
        [`UPDATE del tipo de ${id}`, `UPDATE comprobante SET tipo = 'FACTURA' WHERE id = '${id}'`],
        [
          `UPDATE del cliente de ${id}`,
          `UPDATE comprobante SET cliente_nombre = 'Otro' WHERE id = '${id}'`,
        ],
        [
          `UPDATE de simulado de ${id}`,
          `UPDATE comprobante SET simulado = NOT simulado WHERE id = '${id}'`,
        ],
        [
          `UPDATE del vínculo afecta_a_id de ${id}`,
          `UPDATE comprobante SET afecta_a_id = NULL WHERE id = '${id}'`,
        ],
        [
          `UPDATE del vínculo reemplaza_a_id de ${id}`,
          `UPDATE comprobante SET reemplaza_a_id = '${randomUUID()}' WHERE id = '${id}'`,
        ],
        [`DELETE de ${id}`, `DELETE FROM comprobante WHERE id = '${id}'`],
        [
          `UPDATE de una línea de ${id}`,
          `UPDATE comprobante_linea SET neto = '0.00' WHERE comprobante_id = '${id}'`,
        ],
        [
          `UPDATE de posicion_origen de ${id}`,
          `UPDATE comprobante_linea SET posicion_origen = 9 WHERE comprobante_id = '${id}'`,
        ],
        [
          `DELETE de las líneas de ${id}`,
          `DELETE FROM comprobante_linea WHERE comprobante_id = '${id}'`,
        ],
      );
    }
    intentos.push(
      [
        'UPDATE de la nota_credito',
        `UPDATE nota_credito SET total = '1.00' WHERE comprobante_id = '${notaId}'`,
      ],
      ['DELETE de la nota_credito', `DELETE FROM nota_credito WHERE comprobante_id = '${notaId}'`],
      [
        'UPDATE del egreso',
        `UPDATE movimiento_caja SET monto = '1.00' WHERE comprobante_id = '${notaId}'`,
      ],
      ['DELETE del egreso', `DELETE FROM movimiento_caja WHERE comprobante_id = '${notaId}'`],
    );
    const foto = async () => ({
      nota: (await filas('SELECT to_jsonb(c) AS f FROM comprobante c WHERE id = $1', [notaId]))[0]!
        .f,
      original: (
        await filas('SELECT to_jsonb(c) AS f FROM comprobante c WHERE id = $1', [o.comprobanteId])
      )[0]!.f,
      lineas: (
        await filas(
          'SELECT to_jsonb(l) AS f FROM comprobante_linea l WHERE comprobante_id IN ($1, $2) ORDER BY comprobante_id, posicion',
          [notaId, o.comprobanteId],
        )
      ).map((x) => x.f),
      egresos: (
        await filas('SELECT to_jsonb(m) AS f FROM movimiento_caja m WHERE comprobante_id = $1', [
          notaId,
        ])
      ).map((x) => x.f),
      notaCredito: (
        await filas('SELECT to_jsonb(n) AS f FROM nota_credito n WHERE comprobante_id = $1', [
          notaId,
        ])
      ).map((x) => x.f),
    });
    const antes = await foto();
    const fallos: string[] = [];
    for (const [que, sql] of intentos) {
      await enTransaccion(apiSql, A().id, async () => {
        const error = await errorDe(apiSql.query(sql));
        if (error.code !== '42501') fallos.push(`${que}: ${error.code} ${error.message}`);
      });
    }
    expect(fallos, fallos.join('\n')).toEqual([]);
    expect(await foto()).toEqual(antes);
  });

  it('una nota no reabre la orden ni cambia lo que la orden considera cobrado, y no es una parte de la orden', async () => {
    const o = await boleta();
    const ordenId = o.cuenta.ordenId;
    const fotoDeLaOrden = async () => ({
      orden: (await filas('SELECT to_jsonb(o) AS f FROM orden o WHERE id = $1', [ordenId]))[0]!.f,
      items: (
        await filas('SELECT to_jsonb(i) AS f FROM item i WHERE orden_id = $1 ORDER BY id', [
          ordenId,
        ])
      ).map((x) => x.f),
      partes: await filas(
        'SELECT id, numero_parte FROM comprobante WHERE orden_id = $1 ORDER BY numero_parte',
        [ordenId],
      ),
    });
    const antes = await fotoDeLaOrden();
    expect(antes.orden.estado).toBe('CERRADA');
    await emitirNota(ctx, sup(), {
      comprobanteId: o.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: posicionDe(o.cobro.comprobante, /Lomo/), cantidad: 1 }],
    });
    const otra = await boleta();
    const anulada = await emitirNota(ctx, sup(), {
      comprobanteId: otra.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    await ctx.procesar(A().id, (anulada.nota as Libre).id as string);
    expect(await fotoDeLaOrden()).toEqual(antes);
    expect(
      (await filas(`SELECT estado FROM orden WHERE id = $1`, [otra.cuenta.ordenId]))[0]!.estado,
    ).toBe('CERRADA');
    expect(await notasDelOriginal(o.comprobanteId)).toHaveLength(1);
  });
});
