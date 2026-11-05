// spec: 006-caja-cobro (pruebas protegidas)
//
// P3 · Reporte X y cierre Z (ruta crítica), criterios 29 a 35:
// - 29: el reporte X de un turno con cobros en los cinco medios, redondeos, vueltos, ingresos y egresos, con montos
//   exactos y el esperado de `esperadoDelTurno`; no cambia nada ni cierra el turno;
// - 31 y 32: el cierre Z guarda esperado, contado, diferencia y motivo por medio; toda diferencia exige motivo (422
//   DIFERENCIA_SIN_MOTIVO con `diferencias: [{ medio }]` solo de los medios que no cuadran y sin ningún monto: ni
//   esperado, ni contado, ni diferencia; arqueo a ciegas; el ataque de contar 0.00 en los cinco medios no revela el esperado);
// - 33: el último turno abierto de la sucursal no se cierra con órdenes abiertas (409 CIERRE_BLOQUEADO con `ordenes`);
//   con otro turno abierto sí; dos cierres simultáneos de los dos últimos: exactamente uno se cierra;
// - 34: la Z es definitiva y su réplica devuelve lo guardado; 35: cierra su responsable, un Supervisor o el
//   Administrador; otro Cajero recibe 409 TURNO_AJENO.
// El ejemplo del turno: fondo 200.00; cobros en efectivo 69.20 (vuelto 30.80) y 33.30 (redondeo 0.04, vuelto 16.70),
// tarjeta de crédito 69.20, tarjeta de débito 40.00 con Yape 29.20, y Plin 69.20; un ingreso de 20.00 y un egreso de 15.50.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { reporteCajaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  cobrar,
  cobrarCrudo,
  conteo,
  crearEscenario,
  cuentaC,
  cuentaCon,
  cuerpoDeCobro,
  efectivo,
  escribir,
  esperarError,
  eventosDe,
  exigirEstado,
  filas,
  MEDIOS,
  versionDe,
  yape,
  type AppP5,
  type Escenario,
  type Res,
} from './fabrica-caja';
import { filasAuditoria, sesionDeSoporte } from '../acceso/fabrica-equipos';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: Escenario;
const A = () => esc.A;

beforeAll(async () => {
  ctx = await arrancarCaja({ poolMax: 8 });
  esc = await crearEscenario(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});

const DIFERENCIA = 'Faltó sencillo';
const turnoDe = async (persona: string) =>
  (
    await filas(`SELECT id FROM turno WHERE estado = 'ABIERTO' AND responsable_id = $1`, [
      A().personas[persona]!.id,
    ])
  )[0]?.id as string | undefined;

// El turno del ejemplo, armado una sola vez (la primera prueba que lo pide lo arma).
let ejemplo: Promise<string> | undefined;
async function turnoConCobros(): Promise<string> {
  return (ejemplo ??= (async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '200.00');
    const c = A().token.cajero!;
    const a = await cuentaC(ctx, A());
    await cobrar(ctx, c, a, { turnoId: t, total: '69.20', pagos: [efectivo('69.20', '100.00')] });
    const b = await cuentaCon(ctx, A(), 'S1', [
      ['tostada', 1],
      ['lomo', 1],
    ]);
    await cobrar(ctx, c, b, {
      turnoId: t,
      total: '33.34',
      pagos: [efectivo('33.30', '50.00')],
      redondeo: '0.04',
    });
    const d = await cuentaC(ctx, A());
    await cobrar(ctx, c, d, {
      turnoId: t,
      total: '69.20',
      pagos: [{ medio: 'TARJETA_CREDITO', monto: '69.20', operacion: 'VCH-1' }],
    });
    const e = await cuentaC(ctx, A());
    await cobrar(ctx, c, e, {
      turnoId: t,
      total: '69.20',
      pagos: [{ medio: 'TARJETA_DEBITO', monto: '40.00', operacion: 'VCH-2' }, yape('29.20')],
    });
    const f = await cuentaC(ctx, A());
    await cobrar(ctx, c, f, {
      turnoId: t,
      total: '69.20',
      pagos: [{ medio: 'PLIN', monto: '69.20', operacion: 'PLN-1' }],
    });
    for (const [tipo, monto, motivo] of [
      ['INGRESO', '20.00', 'Cambio para la caja'],
      ['EGRESO', '15.50', 'Compra de hielo'],
    ] as const) {
      exigirEstado(
        await escribir(ctx, c, 'post', `/turnos/${t}/movimientos`, {
          id: randomUUID(),
          tipo,
          monto,
          motivo,
        }),
        201,
        'Movimiento de caja',
      );
    }
    return t;
  })());
}

describe('criterio 29 · reporte X', () => {
  it('suma los cinco medios, los redondeos, los vueltos, los ingresos y los egresos con montos exactos', async () => {
    const turnoId = await turnoConCobros();
    const res = await api(ctx, A().token.cajero!, 'get', `/turnos/${turnoId}/reporte`);
    exigirEstado(res, 200, 'GET /turnos/:id/reporte (006, criterio 29)');
    const x = reporteCajaSchema.parse(res.body);
    expect(x.turno).toMatchObject({ id: turnoId, estado: 'ABIERTO' });
    expect(x.fondo).toBe('200.00');
    expect(x.ventas).toMatchObject({
      total: '310.14',
      cantidad: 5,
      descuentos: '0.00',
      cortesias: '0.00',
      igv: '44.84',
      icbper: '4.00',
      redondeos: '0.04',
      vueltos: '47.50',
    });
    expect(x.ventas.porTipo).toEqual([{ tipo: 'BOLETA', cantidad: 5, total: '310.14' }]);
    const porMedio = Object.fromEntries(x.ventas.porMedio.map((m) => [m.medio, m]));
    expect(porMedio.EFECTIVO).toMatchObject({ cantidad: 2, monto: '102.50' });
    expect(porMedio.TARJETA_CREDITO).toMatchObject({ cantidad: 1, monto: '69.20' });
    expect(porMedio.TARJETA_DEBITO).toMatchObject({ cantidad: 1, monto: '40.00' });
    expect(porMedio.YAPE).toMatchObject({ cantidad: 1, monto: '29.20' });
    expect(porMedio.PLIN).toMatchObject({ cantidad: 1, monto: '69.20' });
    expect(x.movimientos).toMatchObject({ ingresos: '20.00', egresos: '15.50' });
    expect(x.movimientos.lista).toHaveLength(2);
    // El esperado de los cinco medios, en el orden de MEDIOS_PAGO: el efectivo es fondo + cobros + ingresos − egresos.
    expect(x.esperado).toEqual([
      { medio: 'EFECTIVO', monto: '307.00' },
      { medio: 'TARJETA_CREDITO', monto: '69.20' },
      { medio: 'TARJETA_DEBITO', monto: '40.00' },
      { medio: 'YAPE', monto: '29.20' },
      { medio: 'PLIN', monto: '69.20' },
    ]);
    expect(x.cierre).toBeUndefined();
  });

  it('el X de un turno sin ventas trae los cinco medios en cero, sin tipos y con el fondo como esperado en efectivo', async () => {
    await turnoConCobros(); // el turno del ejemplo sigue abierto: este no es el último
    const cajas = await A().cajas();
    const vacio = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2, '50.00');
    const res = await api(ctx, A().token.cajero2, 'get', `/turnos/${vacio}/reporte`);
    exigirEstado(res, 200, 'X de un turno sin ventas');
    const x = reporteCajaSchema.parse(res.body);
    expect(x.ventas).toMatchObject({
      total: '0.00',
      cantidad: 0,
      porTipo: [],
      vueltos: '0.00',
      redondeos: '0.00',
    });
    expect(x.ventas.porMedio).toEqual(
      MEDIOS.map((medio) => ({ medio, cantidad: 0, monto: '0.00' })),
    );
    expect(x.movimientos).toMatchObject({ ingresos: '0.00', egresos: '0.00', lista: [] });
    expect(x.esperado[0]).toEqual({ medio: 'EFECTIVO', monto: '50.00' });
    const motivos = {
      EFECTIVO: 'x',
      TARJETA_CREDITO: 'x',
      TARJETA_DEBITO: 'x',
      YAPE: 'x',
      PLIN: 'x',
    };
    exigirEstado(
      await cerrarTurnoCrudo(
        ctx,
        A().token.cajero2!,
        vacio,
        conteo({ EFECTIVO: '50.00' }, motivos),
      ),
      200,
      'Cerrar',
    );
  });

  it('pedir el X no cambia nada y se puede repetir; el Supervisor lo ve, otro Cajero no', async () => {
    const turnoId = await turnoConCobros();
    const antes = await filas('SELECT estado FROM turno WHERE id = $1', [turnoId]);
    const a = await api(ctx, A().token.cajero!, 'get', `/turnos/${turnoId}/reporte`);
    const b = await api(ctx, A().token.supervisor!, 'get', `/turnos/${turnoId}/reporte`);
    exigirEstado(a, 200, 'X del responsable');
    exigirEstado(b, 200, 'X del Supervisor');
    expect({ ...a.body, generadoEn: 0 }).toEqual({ ...b.body, generadoEn: 0 });
    esperarError(
      await api(ctx, A().token.cajero2!, 'get', `/turnos/${turnoId}/reporte`),
      403,
      'PROHIBIDO',
    );
    expect(await filas('SELECT estado FROM turno WHERE id = $1', [turnoId])).toEqual(antes);
  });
});

describe('criterios 31 y 32 · cierre con Z y arqueo a ciegas', () => {
  const contado = {
    EFECTIVO: '306.50',
    TARJETA_CREDITO: '69.20',
    TARJETA_DEBITO: '40.00',
    YAPE: '29.20',
    PLIN: '69.20',
  };

  it('una diferencia sin motivo responde 422 con solo el medio que no cuadra, sin ningún monto, y no cierra', async () => {
    const turnoId = await turnoConCobros();
    const res = await cerrarTurnoCrudo(ctx, A().token.cajero!, turnoId, conteo(contado));
    esperarError(res, 422, 'DIFERENCIA_SIN_MOTIVO');
    // Solo el efectivo no cuadra (esperado 307.00, contado 306.50); la forma es `[{ medio }]` y nada más.
    expect(res.body.diferencias).toEqual([{ medio: 'EFECTIVO' }]);
    for (const d of res.body.diferencias as Array<Record<string, unknown>>) {
      expect(Object.keys(d)).toEqual(['medio']);
    }
    expect(res.text).not.toMatch(/esperado|307\.00|-0\.50/i);
    expect((res.body.campos as Array<{ campo: string }>).map((c) => c.campo)).toEqual([
      'conteo.0.motivo',
    ]);
    expect((await filas('SELECT estado FROM turno WHERE id = $1', [turnoId]))[0]!.estado).toBe(
      'ABIERTO',
    );
    expect(await filas('SELECT 1 FROM turno_conteo WHERE turno_id = $1', [turnoId])).toEqual([]);
  });

  it('ataque: contar 0.00 en los cinco medios sin motivos responde 422 sin ningún monto del esperado ni de las diferencias, solo los medios', async () => {
    const turnoId = await turnoConCobros();
    const ceros = Object.fromEntries(MEDIOS.map((m) => [m, '0.00']));
    const res = await cerrarTurnoCrudo(ctx, A().token.cajero!, turnoId, conteo(ceros));
    esperarError(res, 422, 'DIFERENCIA_SIN_MOTIVO');
    // Los cinco medios tenían esperado mayor que cero: los cinco no cuadran, en el orden de MEDIOS_PAGO.
    expect(res.body.diferencias).toEqual(MEDIOS.map((medio) => ({ medio })));
    for (const d of res.body.diferencias as Array<Record<string, unknown>>) {
      expect(Object.keys(d)).toEqual(['medio']);
    }
    expect((res.body.campos as Array<{ campo: string }>).map((c) => c.campo)).toEqual(
      MEDIOS.map((_, i) => `conteo.${i}.motivo`),
    );
    // El cuerpo completo (mensaje, campos y diferencias): ningún monto del esperado (307.00, 69.20, 40.00, 29.20) ni
    // su negativo (la diferencia de contar 0), ni nada más que el "0.00" que el cajero escribió.
    for (const monto of ['307.00', '69.20', '40.00', '29.20']) {
      expect(res.text, `el cuerpo no trae ${monto}`).not.toContain(monto);
      expect(res.text, `el cuerpo no trae -${monto}`).not.toContain(`-${monto}`);
    }
    const montos = res.text.match(/(?<![\d.])-?\d+\.\d{2}(?!\d)/g) ?? [];
    expect(montos.filter((m) => m !== '0.00')).toEqual([]);
    expect(res.text).not.toMatch(/esperado/i);
    expect((await filas('SELECT estado FROM turno WHERE id = $1', [turnoId]))[0]!.estado).toBe(
      'ABIERTO',
    );
    expect(await filas('SELECT 1 FROM turno_conteo WHERE turno_id = $1', [turnoId])).toEqual([]);
  });

  it('con el motivo cierra: guarda esperado, contado, diferencia y motivo por medio; un motivo sin diferencia se ignora', async () => {
    const turnoId = await turnoConCobros();
    const clave = randomUUID();
    ctx.publicador.limpiar();
    const res = await cerrarTurnoCrudo(
      ctx,
      A().token.cajero!,
      turnoId,
      conteo(contado, { EFECTIVO: DIFERENCIA, YAPE: 'no hace falta' }),
      clave,
    );
    exigirEstado(res, 200, 'Cerrar con Z (006, criterio 31)');
    const z = reporteCajaSchema.parse(res.body);
    expect(z.turno).toMatchObject({
      estado: 'CERRADO',
      cerradoPor: { id: A().personas.cajero!.id },
    });
    expect(z.cierre!.cerradoPor.id).toBe(A().personas.cajero!.id);
    expect(z.cierre!.conteo).toEqual([
      {
        medio: 'EFECTIVO',
        esperado: '307.00',
        contado: '306.50',
        diferencia: '-0.50',
        motivo: DIFERENCIA,
      },
      {
        medio: 'TARJETA_CREDITO',
        esperado: '69.20',
        contado: '69.20',
        diferencia: '0.00',
        motivo: null,
      },
      {
        medio: 'TARJETA_DEBITO',
        esperado: '40.00',
        contado: '40.00',
        diferencia: '0.00',
        motivo: null,
      },
      { medio: 'YAPE', esperado: '29.20', contado: '29.20', diferencia: '0.00', motivo: null },
      { medio: 'PLIN', esperado: '69.20', contado: '69.20', diferencia: '0.00', motivo: null },
    ]);
    expect(await filas('SELECT 1 FROM turno_conteo WHERE turno_id = $1', [turnoId])).toHaveLength(
      5,
    );
    // La réplica con la misma clave devuelve lo guardado.
    const replica = await cerrarTurnoCrudo(
      ctx,
      A().token.cajero!,
      turnoId,
      conteo(contado, { EFECTIVO: DIFERENCIA, YAPE: 'no hace falta' }),
      clave,
    );
    expect(replica.status).toBe(200);
    expect(replica.body).toEqual(res.body);
    // Se publica turno.cambio una sola vez con ids.
    const eventos = eventosDe(ctx, 'turno.cambio');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.datos).toMatchObject({ turnoId });
    // Una fila de auditoría `cerrar_turno` con el conteo y los motivos.
    const auditoria = (await filasAuditoria(A().id, 'cerrar_turno')).filter((f) =>
      f.texto.includes(turnoId),
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]!.texto).toContain(DIFERENCIA);
  });

  it('la Z es definitiva: el turno cerrado no acepta cobros, movimientos ni otro cierre (409 TURNO_CERRADO)', async () => {
    const turnoId = await turnoConCobros();
    const cuenta = await cuentaC(ctx, A());
    esperarError(
      await cobrarCrudo(
        ctx,
        A().token.cajero!,
        cuenta.ordenId,
        cuerpoDeCobro({ turnoId, version: await versionDe(cuenta.ordenId), total: '69.20' }),
      ),
      409,
      'TURNO_CERRADO',
    );
    esperarError(
      await escribir(ctx, A().token.cajero!, 'post', `/turnos/${turnoId}/movimientos`, {
        id: randomUUID(),
        tipo: 'INGRESO',
        monto: '1.00',
        motivo: 'Tarde',
      }),
      409,
      'TURNO_CERRADO',
    );
    esperarError(
      await cerrarTurnoCrudo(
        ctx,
        A().token.cajero!,
        turnoId,
        conteo(contado, { EFECTIVO: DIFERENCIA }),
      ),
      409,
      'TURNO_CERRADO',
    );
  });

  it('el X de un turno cerrado trae lo mismo que tenía al cerrar, más el cierre', async () => {
    const turnoId = await turnoConCobros();
    const res = await api(ctx, A().token.supervisor!, 'get', `/turnos/${turnoId}/reporte`);
    exigirEstado(res, 200, 'GET /turnos/:id/reporte de un turno cerrado');
    const x = reporteCajaSchema.parse(res.body);
    expect(x.ventas.total).toBe('310.14');
    expect(x.cierre!.conteo[0]).toMatchObject({
      medio: 'EFECTIVO',
      esperado: '307.00',
      diferencia: '-0.50',
    });
  });
});

describe('criterio 35 · quién cierra', () => {
  it('cierra su responsable o un Supervisor; otro Cajero recibe 409 TURNO_AJENO y cerradoPor es quien cerró', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2, '100.00');
    const motivos = {
      EFECTIVO: 'x',
      TARJETA_CREDITO: 'x',
      TARJETA_DEBITO: 'x',
      YAPE: 'x',
      PLIN: 'x',
    };
    // El Cajero que cerró su turno antes abre otro para que haya un cajero ajeno con turno propio.
    const ajeno = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1, '10.00');
    esperarError(
      await cerrarTurnoCrudo(
        ctx,
        A().token.cajero!,
        turnoId,
        conteo({ EFECTIVO: '100.00' }, motivos),
      ),
      409,
      'TURNO_AJENO',
    );
    expect((await filas('SELECT estado FROM turno WHERE id = $1', [turnoId]))[0]!.estado).toBe(
      'ABIERTO',
    );
    const res = await cerrarTurnoCrudo(
      ctx,
      A().token.supervisor!,
      turnoId,
      conteo({ EFECTIVO: '100.00' }, motivos),
    );
    exigirEstado(res, 200, 'El Supervisor cierra el turno del Cajero 2 (006, criterio 35)');
    expect(res.body.turno.cerradoPor).toMatchObject({ id: A().personas.supervisor!.id });
    expect(res.body.cierre.cerradoPor).toMatchObject({ id: A().personas.supervisor!.id });
    expect(res.body.turno.responsable).toMatchObject({ id: A().personas.cajero2!.id });
    void ajeno;
    void turnoDe;
    void yape;
  });
});

describe('criterio 35 · la sesión de soporte no cierra turnos', () => {
  it('cerrar con una sesión de soporte responde 422 REFERENCIA_INVALIDA y el turno sigue abierto', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2, '10.00');
    const soporte = await sesionDeSoporte(ctx.app, esc.sa.token, A().id, A().S1);
    const motivos = {
      EFECTIVO: 'x',
      TARJETA_CREDITO: 'x',
      TARJETA_DEBITO: 'x',
      YAPE: 'x',
      PLIN: 'x',
    };
    esperarError(
      await cerrarTurnoCrudo(ctx, soporte, turnoId, conteo({}, motivos)),
      422,
      'REFERENCIA_INVALIDA',
    );
    expect((await filas('SELECT estado FROM turno WHERE id = $1', [turnoId]))[0]!.estado).toBe(
      'ABIERTO',
    );
    expect(await filas('SELECT 1 FROM turno_conteo WHERE turno_id = $1', [turnoId])).toEqual([]);
    exigirEstado(
      await cerrarTurnoCrudo(ctx, A().token.cajero2!, turnoId, conteo({}, motivos)),
      200,
      'Cerrar',
    );
  });
});

describe('criterio 33 · el último turno no se cierra con mesas abiertas', () => {
  const ordenesAbiertas = async () =>
    (
      await filas(
        `SELECT 1 FROM orden WHERE sucursal_id = $1 AND estado IN ('ABIERTA', 'EN_PRECUENTA')`,
        [A().S3],
      )
    ).length;
  const motivos = {
    EFECTIVO: 'x',
    TARJETA_CREDITO: 'x',
    TARJETA_DEBITO: 'x',
    YAPE: 'x',
    PLIN: 'x',
  };
  const cierre = (token: string, turnoId: string): Promise<Res> =>
    cerrarTurnoCrudo(ctx, token, turnoId, conteo({}, motivos));

  it('con una mesa abierta, el único turno abierto responde 409 CIERRE_BLOQUEADO con `ordenes` y nada cambia', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.cajeroS3!, cajas.S3!.caja1, '100.00');
    await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    expect(await ordenesAbiertas()).toBe(1);
    const res = await cierre(A().token.cajeroS3!, turnoId);
    esperarError(res, 409, 'CIERRE_BLOQUEADO');
    expect(res.body.ordenes).toBe(1);
    expect((await filas('SELECT estado FROM turno WHERE id = $1', [turnoId]))[0]!.estado).toBe(
      'ABIERTO',
    );
    expect(await filas('SELECT 1 FROM turno_conteo WHERE turno_id = $1', [turnoId])).toEqual([]);
  });

  it('si hay otro turno abierto en la sucursal, el cierre se hace igual; el último queda bloqueado hasta cerrar la mesa', async () => {
    const cajas = await A().cajas();
    const primero = (
      await filas(`SELECT id FROM turno WHERE estado = 'ABIERTO' AND caja_id = $1`, [
        cajas.S3!.caja1,
      ])
    )[0]!.id as string;
    const segundo = await abrirTurno(ctx, A().token.supervisorS3!, cajas.S3!.caja2, '100.00');
    exigirEstado(
      await cierre(A().token.cajeroS3!, primero),
      200,
      'Cierra el primero (hay otro abierto)',
    );
    // El segundo es ahora el último: bloqueado mientras la mesa siga abierta.
    esperarError(await cierre(A().token.supervisorS3!, segundo), 409, 'CIERRE_BLOQUEADO');
    const [orden] = await filas(
      `SELECT id FROM orden WHERE sucursal_id = $1 AND estado IN ('ABIERTA', 'EN_PRECUENTA')`,
      [A().S3],
    );
    exigirEstado(
      await escribir(ctx, A().token.supervisorS3!, 'post', `/ordenes/${orden!.id}/anulacion`, {
        motivo: 'Se fue el cliente',
        destinoStock: 'VUELVE',
      }),
      200,
      'Anular la orden (004)',
    );
    exigirEstado(await cierre(A().token.supervisorS3!, segundo), 200, 'Cierra el último sin mesas');
  });

  it('dos cierres simultáneos de los dos últimos turnos con una mesa abierta: exactamente uno se cierra', async () => {
    const cajas = await A().cajas();
    const t1 = await abrirTurno(ctx, A().token.cajeroS3!, cajas.S3!.caja1, '50.00');
    const t2 = await abrirTurno(ctx, A().token.supervisorS3!, cajas.S3!.caja2, '50.00');
    await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    const [a, b] = await Promise.all([
      cierre(A().token.cajeroS3!, t1),
      cierre(A().token.supervisorS3!, t2),
    ]);
    expect([a.status, b.status].sort(), `${a.text} | ${b.text}`).toEqual([200, 409]);
    expect((a.status === 409 ? a : b).body.codigo).toBe('CIERRE_BLOQUEADO');
    const abiertos = await filas(
      `SELECT id FROM turno WHERE estado = 'ABIERTO' AND sucursal_id = $1`,
      [A().S3],
    );
    expect(abiertos).toHaveLength(1);
  });

  it('bloquean ABIERTA y EN_PRECUENTA; una orden UNIDA no cuenta y `ordenes` es cuántas hay en esos dos estados', async () => {
    const [ultimo] = await filas(
      `SELECT id, responsable_id FROM turno WHERE estado = 'ABIERTO' AND sucursal_id = $1`,
      [A().S3],
    );
    const token =
      ultimo!.responsable_id === A().personas.cajeroS3!.id
        ? A().token.cajeroS3!
        : A().token.supervisorS3!;
    const enPrecuenta = await cuentaCon(ctx, A(), 'S3', [['lomo', 1]]);
    exigirEstado(
      await escribir(ctx, enPrecuenta.token, 'post', `/ordenes/${enPrecuenta.ordenId}/precuentas`, {
        id: randomUUID(),
      }),
      201,
      'Pedir la pre-cuenta',
    );
    const principal = await cuentaCon(ctx, A(), 'S3', [['gaseosa', 1]]);
    const absorbida = await cuentaCon(ctx, A(), 'S3', [['gaseosa', 1]]);
    exigirEstado(
      await escribir(ctx, principal.token, 'post', `/ordenes/${principal.ordenId}/union`, {
        mesaIds: [absorbida.mesaId],
      }),
      200,
      'Unir las mesas',
    );
    const esperadas = await ordenesAbiertas();
    expect(esperadas).toBeGreaterThanOrEqual(3);
    const res = await cierre(token, ultimo!.id as string);
    esperarError(res, 409, 'CIERRE_BLOQUEADO');
    expect(res.body.ordenes).toBe(esperadas);
    expect((await filas(`SELECT estado FROM turno WHERE id = $1`, [ultimo!.id]))[0]!.estado).toBe(
      'ABIERTO',
    );
  });
});
