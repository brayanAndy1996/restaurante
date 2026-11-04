// spec: 006-caja-cobro (pruebas protegidas)
//
// P4 · Comprobantes, series y correlativos (ruta crítica), criterios 69 a 78:
// - 69 y 75: lo que guarda cada comprobante tal como era al emitirse (no cambia si cambian la carta, la sucursal o la
//   tasa) y que nace `POR_ENVIAR`;
// - 70: numeración (`B001-00000124`), siguiente número de la serie de la caja del turno, `SERIE_AGOTADA` en 99999999;
// - 71: sin saltos: un cobro que falla después de numerar no consume el número;
// - 72: cien cobros concurrentes entre dos cajas (y cobros concurrentes en la misma caja) sin repetidos ni huecos;
// - 73: las réplicas y los rechazos no numeran; 74: fecha de emisión (Lima) y día operativo; la tasa de la fecha;
// - 76: la cuota del plan, una vez por comprobante y revertida con el cobro;
// - 77: consultas con el alcance del Cajero; 78: la API no puede borrar ni cambiar montos de un comprobante.
// La falla inyectada del criterio 71 es un trigger temporal creado como administrador que lanza un error al encolar el
// ticket de un cobro concreto (el último paso antes de confirmar), porque el puerto de impresión no se puede
// reemplazar desde fuera de la aplicación.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { comprobanteRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { abrirCliente } from '../utilidades';
import {
  abrirTurno,
  api,
  arrancarCaja,
  caja,
  cerrarAdmin,
  Cierres,
  cobrar,
  cobrarCrudo,
  cobrosDeLaOrden,
  comprobantesDeLaOrden,
  crearEscenario,
  cuentaC,
  cuentaCon,
  cuerpoDeCobro,
  efectivo,
  esperarError,
  exigirEstado,
  fallarElTicketDelCobro,
  filas,
  impresoraDeCaja,
  ponerTasa,
  sesionContrasena,
  ultimoNumero,
  versionDe,
  yape,
  type AppP5,
  type Cuenta,
  type Escenario,
  type Res,
} from './fabrica-caja';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
let apiSql: Client;
const cierres = new Cierres();
const A = () => esc.A;
let tokenCajero: string;
let tokenCajero2: string;
let tokenSupervisor: string;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
  apiSql = await abrirCliente('api');
  tokenCajero = A().token.cajero!;
  tokenCajero2 = A().token.cajero2!;
  tokenSupervisor = A().token.supervisor!;
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await apiSql?.end();
  await cerrarAdmin();
});

let t1: Promise<string> | undefined;
const turno1 = () =>
  (t1 ??= (async () => abrirTurno(ctx, tokenCajero, (await A().cajas()).S1!.caja1))());
let t2: Promise<string> | undefined;
const turno2 = () =>
  (t2 ??= (async () => abrirTurno(ctx, tokenCajero2, (await A().cajas()).S1!.caja2))());

/** Crea `n` cuentas de un Lomo (28.00) con concurrencia moderada. */
async function cuentasSimples(n: number): Promise<Cuenta[]> {
  const hechas: Cuenta[] = [];
  for (let i = 0; i < n; i += 10) {
    hechas.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(10, n - i) }, () => cuentaCon(ctx, A(), 'S1', [['lomo', 1]])),
      )),
    );
  }
  return hechas;
}

async function cobrarSimple(
  token: string,
  cuenta: Cuenta,
  turnoId: string,
  id = randomUUID(),
): Promise<Res> {
  const version = await versionDe(cuenta.ordenId);
  return cobrarCrudo(
    ctx,
    token,
    cuenta.ordenId,
    cuerpoDeCobro({ id, turnoId, version, total: '28.00', pagos: [yape('28.00')] }),
  );
}

// ------------------------------------------------------------------------------------------------
describe('criterios 69 y 75 · lo que guarda el comprobante', () => {
  it('guarda emisor, sucursal, caja, turno, cliente, líneas, totales, letras y la orden tal como eran', async () => {
    const cuenta = await cuentaC(ctx, A());
    const turnoId = await turno1();
    const cobro = await cobrar(ctx, tokenCajero, cuenta, { turnoId, total: '69.20' });
    const res = await api(ctx, tokenCajero, 'get', `/comprobantes/${cobro.comprobante.id}`);
    exigirEstado(res, 200, 'GET /comprobantes/:id (006, criterio 77)');
    const c = comprobanteRespuestaSchema.parse(res.body);
    const cajas = await A().cajas();
    expect(c).toMatchObject({
      tipo: 'BOLETA',
      serie: 'B001',
      estado: 'POR_ENVIAR',
      formato: 'DETALLADO',
      fechaEmision: '2026-11-02',
      diaOperativo: '2026-11-02',
      cajaId: cajas.S1!.caja1,
      turnoId,
      turnoResponsableId: A().personas.cajero!.id,
      cobroId: cobro.id,
      numeroParte: 1,
      cliente: null,
      moneda: 'PEN',
      tasaIgv: '18.00',
      emisor: { regimen: 'GENERAL' },
      sucursal: { codigoEstablecimiento: '0001' },
      totales: {
        subtotal: '68.20',
        descuentos: '0.00',
        operaciones: {
          gravadas: '55.26',
          exoneradas: '3.00',
          inafectas: '0.00',
          gratuitas: '0.00',
        },
        igv: '9.94',
        igvGratuitas: '0.00',
        icbper: '1.00',
        total: '69.20',
      },
      montoEnLetras: 'SESENTA Y NUEVE CON 20/100 SOLES',
      orden: { id: cuenta.ordenId, numeroLlamado: null },
    });
    expect(c.numero).toBe(`B001-${String(c.correlativo).padStart(8, '0')}`);
    expect(c.orden!.mesas).toHaveLength(1);
    const porNombre = Object.fromEntries(c.lineas.map((l) => [l.descripcion, l]));
    const lomo = Object.values(porNombre).find((l) => l.descripcion.startsWith('Lomo'))!;
    expect(lomo).toMatchObject({
      cantidad: 2,
      precioUnitario: '28.00',
      bruto: '56.00',
      descuento: '0.00',
      neto: '56.00',
      base: '47.46',
      igv: '8.54',
      afectacion: 'GRAVADO',
      unidad: 'NIU',
      gratuita: false,
    });
    expect(lomo.valorUnitario).toMatch(/^\d+\.\d{10}$/);
    expect(Math.abs(Number(lomo.valorUnitario) - 28 / 1.18)).toBeLessThan(0.01);
    expect(c.lineas.find((l) => l.descripcion.startsWith('Gaseosa'))).toMatchObject({
      neto: '9.00',
      base: '7.63',
      igv: '1.37',
    });
    expect(c.lineas.find((l) => l.descripcion.startsWith('Bolsa'))).toMatchObject({
      cantidad: 2,
      bruto: '0.20',
      base: '0.17',
      igv: '0.03',
      bolsas: 2,
      icbper: '1.00',
    });
    expect(c.lineas.find((l) => l.descripcion.startsWith('Mandarina'))).toMatchObject({
      neto: '3.00',
      base: '3.00',
      igv: '0.00',
      afectacion: 'EXONERADO',
    });
    // Guarda el detalle calculado de la parte y su lugar entre las partes (para las partes siguientes).
    const [fila] = await filas(
      'SELECT detalle_parte, numero_parte FROM comprobante WHERE id = $1',
      [c.id],
    );
    expect(fila!.detalle_parte).toBeTruthy();
    expect(Number(fila!.numero_parte)).toBe(1);
  });

  it('un cambio posterior de la carta, de la sucursal o de la tasa no altera el comprobante', async () => {
    const cuenta = await cuentaC(ctx, A());
    const cobro = await cobrar(ctx, tokenCajero, cuenta, {
      turnoId: await turno1(),
      total: '69.20',
    });
    const leer = async () =>
      (await api(ctx, tokenCajero, 'get', `/comprobantes/${cobro.comprobante.id}`)).body;
    const antes = await leer();
    exigirEstado(
      await api(ctx, A().token.admin, 'patch', `/carta/productos/${A().carta.lomo.id}`, {
        precio: '99.00',
      }),
      200,
      'Cambiar el precio',
    );
    exigirEstado(
      await api(ctx, A().token.admin, 'patch', `/sucursales/${A().S1}`, {
        nombre: 'Sucursal renombrada',
        direccion: 'Otra dirección 1',
      }),
      200,
      'Cambiar la sucursal (002)',
    );
    exigirEstado(
      await ponerTasa(ctx, A().token.admin!, A().emisor1, '2026-12-01', '10.00'),
      200,
      'Una tasa futura',
    );
    try {
      expect(await leer()).toEqual(antes);
    } finally {
      await api(ctx, A().token.admin, 'patch', `/carta/productos/${A().carta.lomo.id}`, {
        precio: '28.00',
      });
    }
  });

  it('ninguna ruta de 6a cambia el estado: todo comprobante sigue POR_ENVIAR', async () => {
    const estados = await filas('SELECT DISTINCT estado FROM comprobante WHERE sucursal_id = $1', [
      A().S1,
    ]);
    expect(estados.map((e) => e.estado)).toEqual(['POR_ENVIAR']);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 70 · numeración', () => {
  it('cada comprobante toma el número siguiente de la serie de la caja del turno', async () => {
    const turnoId = await turno1();
    const caja1 = (await A().cajas()).S1!.caja1;
    const antes = await ultimoNumero(caja1, 'BOLETA');
    const a = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), { turnoId, total: '69.20' });
    const b = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), { turnoId, total: '69.20' });
    expect(a.comprobante.numero).toBe(`B001-${String(antes + 1).padStart(8, '0')}`);
    expect(b.comprobante.numero).toBe(`B001-${String(antes + 2).padStart(8, '0')}`);
    expect(await ultimoNumero(caja1, 'BOLETA')).toBe(antes + 2);
  });

  it('en 99999999 la serie se agota: el siguiente cobro responde 409 SERIE_AGOTADA y no numera', async () => {
    const cajaAgotada = await caja(ctx, A().token.admin!, A().S1, 'Caja agotada', {});
    exigirEstado(
      await api(
        ctx,
        A().token.admin,
        'put',
        `/sucursales/${A().S1}/cajas/${cajaAgotada}/series/BOLETA`,
        {
          serie: 'B999',
          primerNumero: 99999999,
        },
      ),
      200,
      'Serie en su último número',
    );
    const turnoId = await abrirTurno(ctx, tokenSupervisor, cajaAgotada, '10.00');
    const ultima = await cobrar(ctx, tokenSupervisor, await cuentaC(ctx, A()), {
      turnoId,
      total: '69.20',
    });
    expect(ultima.comprobante.numero).toBe('B999-99999999');
    const cuenta = await cuentaC(ctx, A());
    const res = await cobrarCrudo(
      ctx,
      tokenSupervisor,
      cuenta.ordenId,
      cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
    );
    esperarError(res, 409, 'SERIE_AGOTADA');
    expect(await filas('SELECT 1 FROM comprobante WHERE orden_id = $1', [cuenta.ordenId])).toEqual(
      [],
    );
    expect(await ultimoNumero(cajaAgotada, 'BOLETA')).toBe(99999999);
    exigirEstado(
      await api(
        ctx,
        tokenSupervisor,
        'post',
        `/turnos/${turnoId}/cierre`,
        {
          conteo: ['EFECTIVO', 'TARJETA_CREDITO', 'TARJETA_DEBITO', 'YAPE', 'PLIN'].map(
            (medio) => ({
              medio,
              contado: '0.00',
              motivo: 'x',
            }),
          ),
        },
        { 'Idempotency-Key': randomUUID() },
      ),
      200,
      'Cerrar el turno de la caja agotada',
    );
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 71 · sin saltos', () => {
  it('un cobro que falla después de numerar no consume el número: el siguiente cobro bueno lo usa', async () => {
    const cajas = await A().cajas();
    const turnoId = await turno1();
    await impresoraDeCaja(ctx, cierres, A().token.admin!, A().S1, 'Caja de S1', {
      cajaId: cajas.S1!.caja1,
    });
    const antes = await ultimoNumero(cajas.S1!.caja1, 'BOLETA');
    const consumoAntes = await filas(
      'SELECT emitidos FROM consumo_comprobantes WHERE sucursal_id = $1',
      [A().S1],
    );
    const mala = await cuentaC(ctx, A());
    const idMalo = randomUUID();
    const quitar = await fallarElTicketDelCobro(idMalo);
    try {
      const res = await cobrarCrudo(
        ctx,
        tokenCajero,
        mala.ordenId,
        cuerpoDeCobro({
          id: idMalo,
          turnoId,
          version: await versionDe(mala.ordenId),
          total: '69.20',
        }),
      );
      expect(res.status, res.text).toBeGreaterThanOrEqual(500);
      expect(res.text).not.toMatch(/falla inyectada|trigger|violates/i);
    } finally {
      await quitar();
    }
    expect(await ultimoNumero(cajas.S1!.caja1, 'BOLETA')).toBe(antes);
    expect(await cobrosDeLaOrden(mala.ordenId)).toEqual([]);
    expect(await comprobantesDeLaOrden(mala.ordenId)).toEqual([]);
    expect(
      await filas('SELECT emitidos FROM consumo_comprobantes WHERE sucursal_id = $1', [A().S1]),
    ).toEqual(consumoAntes);
    const buena = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), {
      turnoId,
      total: '69.20',
    });
    expect(buena.comprobante.numero).toBe(`B001-${String(antes + 1).padStart(8, '0')}`);
    // El mismo cobro fallido, reintentado ya sin la falla, sale con el siguiente número sin hueco.
    const reintento = await cobrar(ctx, tokenCajero, mala, { id: idMalo, turnoId, total: '69.20' });
    expect(reintento.comprobante.numero).toBe(`B001-${String(antes + 2).padStart(8, '0')}`);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 72 · sin duplicados con dos cajas', () => {
  it('cien cobros concurrentes repartidos entre la Caja 1 y la Caja 2 dejan números consecutivos sin repetidos ni huecos', async () => {
    const cajas = await A().cajas();
    const tc1 = await turno1();
    const tc2 = await turno2();
    const antes1 = await ultimoNumero(cajas.S1!.caja1, 'BOLETA');
    const antes2 = await ultimoNumero(cajas.S1!.caja2, 'BOLETA');
    const cuentas = await cuentasSimples(100);
    const respuestas = await Promise.all(
      cuentas.map((c, i) =>
        i % 2 === 0 ? cobrarSimple(tokenCajero, c, tc1) : cobrarSimple(tokenCajero2, c, tc2),
      ),
    );
    for (const r of respuestas) expect(r.status, r.text).toBe(201);
    const porSerie = async (serie: string) =>
      (
        await filas(
          'SELECT numero FROM comprobante WHERE sucursal_id = $1 AND serie = $2 ORDER BY numero',
          [A().S1, serie],
        )
      ).map((f) => Number(f.numero));
    const s1 = (await porSerie('B001')).filter((n) => n > antes1);
    const s2 = (await porSerie('B002')).filter((n) => n > antes2);
    expect(s1).toEqual(Array.from({ length: 50 }, (_, i) => antes1 + 1 + i));
    expect(s2).toEqual(Array.from({ length: 50 }, (_, i) => antes2 + 1 + i));
    // Cada comprobante con la serie de su caja.
    const mal = await filas(
      `SELECT 1 FROM comprobante c WHERE c.sucursal_id = $1 AND ((c.caja_id = $2 AND c.serie <> 'B001' AND c.tipo = 'BOLETA') OR (c.caja_id = $3 AND c.serie <> 'B002' AND c.tipo = 'BOLETA'))`,
      [A().S1, cajas.S1!.caja1, cajas.S1!.caja2],
    );
    expect(mal).toEqual([]);
  });

  it('cobros concurrentes en la misma caja (el Cajero y un Supervisor en su turno) tampoco repiten ni saltan', async () => {
    const cajas = await A().cajas();
    const turnoId = await turno1();
    const antes = await ultimoNumero(cajas.S1!.caja1, 'BOLETA');
    const cuentas = await cuentasSimples(30);
    const respuestas = await Promise.all(
      cuentas.map((c, i) => cobrarSimple(i % 2 === 0 ? tokenCajero : tokenSupervisor, c, turnoId)),
    );
    for (const r of respuestas) expect(r.status, r.text).toBe(201);
    const numeros = respuestas
      .map((r) => Number(r.body.comprobante.correlativo))
      .sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: 30 }, (_, i) => antes + 1 + i));
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 73 · réplicas y rechazos no numeran', () => {
  it('ni una réplica ni un cobro rechazado (400, 403, 404, 409, 422) consumen un número', async () => {
    const cajas = await A().cajas();
    const turnoId = await turno1();
    const cuenta = await cuentaC(ctx, A());
    const version = await versionDe(cuenta.ordenId);
    const base = cuerpoDeCobro({ turnoId, version, total: '69.20' });
    const antes = await ultimoNumero(cajas.S1!.caja1, 'BOLETA');
    const rechazos = await Promise.all([
      cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, { ...base, id: 'no-es-uuid' }),
      cobrarCrudo(ctx, A().token.mozo!, cuenta.ordenId, base),
      cobrarCrudo(ctx, tokenCajero, randomUUID(), base),
      cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, { ...base, version: version + 7 }),
      cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, { ...base, pagos: [efectivo('69.19')] }),
    ]);
    expect(rechazos.map((r) => r.status)).toEqual([400, 403, 404, 409, 422]);
    expect(await ultimoNumero(cajas.S1!.caja1, 'BOLETA')).toBe(antes);
    const clave = randomUUID();
    exigirEstado(await cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, base, clave), 201, 'Cobrar');
    expect(await ultimoNumero(cajas.S1!.caja1, 'BOLETA')).toBe(antes + 1);
    exigirEstado(await cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, base, clave), 201, 'Réplica');
    exigirEstado(
      await cobrarCrudo(ctx, tokenCajero, cuenta.ordenId, base),
      201,
      'Mismo id con otra clave',
    );
    expect(await ultimoNumero(cajas.S1!.caja1, 'BOLETA')).toBe(antes + 1);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 76 · cuota del plan', () => {
  it('cada comprobante cuenta una vez en el consumo del mes de Lima; un cobro revertido no cuenta', async () => {
    const turnoId = await turno1();
    const consumo = async () =>
      Number(
        (
          await filas(
            `SELECT coalesce(sum(emitidos), 0) AS n FROM consumo_comprobantes WHERE sucursal_id = $1 AND periodo = '2026-11'`,
            [A().S1],
          )
        )[0]!.n,
      );
    const antes = await consumo();
    const cuentas = await cuentasSimples(10);
    for (const c of cuentas)
      await cobrar(ctx, tokenCajero, c, { turnoId, total: '28.00', pagos: [yape('28.00')] });
    expect(await consumo()).toBe(antes + 10);
    const mala = await cuentaC(ctx, A());
    const idMalo = randomUUID();
    const quitar = await fallarElTicketDelCobro(idMalo);
    try {
      const res = await cobrarCrudo(
        ctx,
        tokenCajero,
        mala.ordenId,
        cuerpoDeCobro({
          id: idMalo,
          turnoId,
          version: await versionDe(mala.ordenId),
          total: '69.20',
        }),
      );
      expect(res.status).toBeGreaterThanOrEqual(500);
    } finally {
      await quitar();
    }
    expect(await consumo()).toBe(antes + 10);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 77 · consultar', () => {
  it('lista los comprobantes de una orden o de un turno, del más nuevo al más antiguo, con el alcance del Cajero', async () => {
    const turnoId = await turno1();
    const cuenta = await cuentaC(ctx, A());
    const p1 = await cobrar(ctx, tokenCajero, cuenta, {
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
    const p2 = await cobrar(ctx, tokenCajero, cuenta, { turnoId, total: '32.20' });
    const porOrden = await api(ctx, tokenCajero, 'get', `/comprobantes?ordenId=${cuenta.ordenId}`);
    exigirEstado(porOrden, 200, 'GET /comprobantes?ordenId=');
    expect(porOrden.body.map((c: { id: string }) => c.id)).toEqual([
      p2.comprobante.id,
      p1.comprobante.id,
    ]);
    expect(porOrden.body[0]).toMatchObject({
      tipo: 'BOLETA',
      total: '32.20',
      estado: 'POR_ENVIAR',
      ordenId: cuenta.ordenId,
    });
    const porTurno = await api(ctx, tokenCajero, 'get', `/comprobantes?turnoId=${turnoId}`);
    exigirEstado(porTurno, 200, 'GET /comprobantes?turnoId=');
    expect(porTurno.body.length).toBeGreaterThanOrEqual(2);
    expect(porTurno.body.length).toBeLessThanOrEqual(200);
    // Otro Cajero no ve los de un turno ajeno; el Supervisor sí; B no ve nada de A.
    esperarError(
      await api(ctx, tokenCajero2, 'get', `/comprobantes/${p1.comprobante.id}`),
      403,
      'PROHIBIDO',
    );
    esperarError(
      await api(ctx, tokenCajero2, 'get', `/comprobantes?turnoId=${turnoId}`),
      403,
      'PROHIBIDO',
    );
    exigirEstado(
      await api(ctx, tokenSupervisor, 'get', `/comprobantes/${p1.comprobante.id}`),
      200,
      'El Supervisor ve cualquiera',
    );
    expect(
      (await api(ctx, esc.B.token.cajero, 'get', `/comprobantes/${p1.comprobante.id}`)).status,
    ).toBe(404);
    esperarError(
      await api(ctx, A().token.mozo, 'get', `/comprobantes/${p1.comprobante.id}`),
      403,
      'PROHIBIDO',
    );
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 78 · inmutable', () => {
  it('restaurante_api no puede borrar comprobantes ni cambiar sus montos; el rechazo es de permisos', async () => {
    const cobro = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), {
      turnoId: await turno1(),
      total: '69.20',
    });
    const id = cobro.comprobante.id as string;
    const intentos: Array<[string, string]> = [
      ['UPDATE de un monto', `UPDATE comprobante SET total = '1.00' WHERE id = '${id}'`],
      ['UPDATE del IGV', `UPDATE comprobante SET igv = '0.00' WHERE id = '${id}'`],
      ['UPDATE del número', `UPDATE comprobante SET numero = numero + 1 WHERE id = '${id}'`],
      [
        'UPDATE del detalle de la parte',
        `UPDATE comprobante SET detalle_parte = '{}'::jsonb WHERE id = '${id}'`,
      ],
      ['DELETE del comprobante', `DELETE FROM comprobante WHERE id = '${id}'`],
      [
        'UPDATE de una línea',
        `UPDATE comprobante_linea SET neto = '0.00' WHERE comprobante_id = '${id}'`,
      ],
      ['DELETE de las líneas', `DELETE FROM comprobante_linea WHERE comprobante_id = '${id}'`],
    ];
    const antes = (
      await filas('SELECT to_jsonb(c) AS f FROM comprobante c WHERE id = $1', [id])
    )[0]!.f;
    for (const [que, sql] of intentos) {
      await enTransaccion(apiSql, A().id, async () => {
        const error = await errorDe(apiSql.query(sql));
        expect(error.code, `${que}: ${error.message}`).toBe('42501');
        expect(error.message, que).toMatch(/permission denied/i);
      });
    }
    expect(
      (await filas('SELECT to_jsonb(c) AS f FROM comprobante c WHERE id = $1', [id]))[0]!.f,
    ).toEqual(antes);
    expect(
      (await filas('SELECT 1 FROM comprobante_linea WHERE comprobante_id = $1', [id])).length,
    ).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe('criterio 74 · fecha de emisión y día operativo', () => {
  it('a las 02:00 del 5 la fecha de emisión es el 5 y el día operativo el 4; la tasa es la de la fecha de emisión', async () => {
    const turnoId = await turno1();
    exigirEstado(
      await ponerTasa(ctx, A().token.admin!, A().emisor1, '2026-11-06', '20.00'),
      200,
      'Una tasa desde el 6',
    );
    ctx.reloj.fijar('2026-11-05T02:00:00-05:00');
    tokenCajero = await sesionContrasena(ctx, A().personas.cajero!, A().S1);
    const madrugada = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), {
      turnoId,
      total: '69.20',
    });
    expect(madrugada.comprobante).toMatchObject({
      fechaEmision: '2026-11-05',
      diaOperativo: '2026-11-04',
      tasaIgv: '18.00',
    });

    ctx.reloj.fijar('2026-11-05T23:59:00-05:00');
    tokenCajero = await sesionContrasena(ctx, A().personas.cajero!, A().S1);
    const antesDelCambio = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), {
      turnoId,
      total: '69.20',
    });
    expect(antesDelCambio.comprobante).toMatchObject({
      fechaEmision: '2026-11-05',
      tasaIgv: '18.00',
    });

    ctx.reloj.fijar('2026-11-06T00:01:00-05:00');
    tokenCajero = await sesionContrasena(ctx, A().personas.cajero!, A().S1);
    const despues = await cobrar(ctx, tokenCajero, await cuentaC(ctx, A()), {
      turnoId,
      total: '69.20',
    });
    expect(despues.comprobante).toMatchObject({
      fechaEmision: '2026-11-06',
      diaOperativo: '2026-11-05',
      tasaIgv: '20.00',
    });
    expect(despues.comprobante.totales.igv).not.toBe('9.94');
    const [guardado] = await filas(
      'SELECT fecha_emision::text AS f, dia_operativo::text AS d FROM comprobante WHERE id = $1',
      [madrugada.comprobante.id],
    );
    expect(guardado).toEqual({ f: '2026-11-05', d: '2026-11-04' });
  });

  it('no se puede crear ni cambiar una tasa con desde igual o anterior a la fecha de un comprobante ya emitido', async () => {
    for (const desde of ['2026-11-02', '2026-11-05', '2026-01-01']) {
      esperarError(
        await ponerTasa(ctx, A().token.admin!, A().emisor1, desde, '15.00'),
        409,
        'CONFLICTO',
      );
    }
  });
});
