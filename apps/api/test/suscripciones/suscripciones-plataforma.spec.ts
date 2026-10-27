// Pruebas del desarrollador (no protegidas) de la tarea T28 · criterios 73, 74, 76, 79 y 83:
// `GET /plataforma/suscripciones`, `PATCH /plataforma/suscripciones/:id` y
// `POST /plataforma/suscripciones/:id/pagos` (idempotente), con el reloj de la API controlado.
import {
  pagoRegistradoRespuestaSchema,
  planRespuestaSchema,
  suscripcionResumenSchema,
  suscripcionRespuestaSchema,
} from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuscripcionService } from '../../src/modulos/plataforma';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente } from '../utilidades';
import { textoUnico } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  bearer,
  exigirEstado,
  filasDeAuditoria,
  nuevoSuperadmin,
  type AppDePrueba,
  type EmpresaDePrueba,
  type SuperadminDePrueba,
} from '../acceso/fabrica-plataforma';

/** Miércoles 15 de mayo de 2030, 10:00 en Lima. */
const INICIO = '2030-05-15T10:00:00-05:00';

let ctx: AppDePrueba;
let admin: Client;
let sa: SuperadminDePrueba;
let empresa: EmpresaDePrueba;

const [ACTIVA, EN_GRACIA, SUSPENDIDA] = [0, 1, 2] as const;

beforeAll(async () => {
  ctx = await arrancar({ inicio: INICIO });
  admin = await abrirCliente('admin');
  sa = await nuevoSuperadmin(ctx);
  // Con 7 días de gracia (BASE): el 15 de mayo, un vencimiento del 20 está activo, el del 10 en gracia
  // (suspende el 18) y el del 1 suspendido. El alta no admite vencimientos pasados: se ajustan después.
  empresa = await altaEmpresa(ctx, sa, { conSesion: false, sucursalesPorEmisor: 3 });
  const vencimientos = ['2030-05-20', '2030-05-10', '2030-05-01'];
  for (const [i, sucursal] of empresa.sucursales.entries()) {
    exigirEstado(
      await ctx
        .http()
        .patch(`/plataforma/suscripciones/${empresa.suscripciones[sucursal.id]!.id}`)
        .set(bearer(sa.token))
        .send({ vencimiento: vencimientos[i], motivo: 'Vencimiento de prueba' }),
      200,
      'ajustar el vencimiento',
    );
  }
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const sucursalDe = (i: number) => empresa.sucursales[i]!;
const suscripcionDe = (i: number) => empresa.suscripciones[sucursalDe(i).id]!.id;

const listar = async (consulta = '') => {
  const res = await ctx.http().get(`/plataforma/suscripciones${consulta}`).set(bearer(sa.token));
  exigirEstado(res, 200, 'listar suscripciones');
  return suscripcionResumenSchema
    .array()
    .parse(res.body)
    .filter((s) => s.empresaId === empresa.empresaId);
};

const crearPlan = async (extra: Record<string, unknown> = {}) => {
  const res = await ctx
    .http()
    .post('/plataforma/planes')
    .set(bearer(sa.token))
    .send({
      codigo: `S-${randomUUID().slice(0, 8)}`,
      nombre: 'Plan de suscripción',
      diasGracia: 7,
      modulos: ['SALON'],
      porDefecto: false,
      activo: true,
      motivo: textoUnico('motivo-plan'),
      ...extra,
    });
  exigirEstado(res, 201, 'crear plan');
  return planRespuestaSchema.parse(res.body);
};

const emitir = (sucursalId: string, instante: string) =>
  ctx.app
    .get(ContextoEmpresa)
    .ejecutar(
      empresa.empresaId,
      () =>
        ctx.app.get(SuscripcionService).registrarComprobanteEmitido(sucursalId, new Date(instante)),
      { actor: { sistema: 'prueba' } },
    );

describe('GET /plataforma/suscripciones (criterio 76)', () => {
  it('lista una fila por sucursal con empresa, plan, vencimiento y el estado calculado con el reloj', async () => {
    const filas = await listar();
    expect(filas).toHaveLength(3);
    const porSucursal = new Map(filas.map((f) => [f.sucursalId, f]));
    expect(porSucursal.get(sucursalDe(ACTIVA).id)).toMatchObject({
      id: suscripcionDe(ACTIVA),
      empresaNombre: empresa.nombre,
      sucursalNombre: sucursalDe(ACTIVA).nombre,
      plan: { codigo: 'BASE' },
      vencimiento: '2030-05-20',
      estado: 'ACTIVA',
      suspensionDesde: '2030-05-28',
      diasRestantesGracia: null,
    });
    expect(porSucursal.get(sucursalDe(EN_GRACIA).id)).toMatchObject({
      estado: 'EN_GRACIA',
      suspensionDesde: '2030-05-18',
      diasRestantesGracia: 3,
    });
    expect(porSucursal.get(sucursalDe(SUSPENDIDA).id)).toMatchObject({
      estado: 'SUSPENDIDA',
      suspensionDesde: '2030-05-09',
      diasRestantesGracia: null,
    });
  });

  it('?estado= filtra por el estado calculado y un estado desconocido responde 400', async () => {
    for (const [estado, indice] of [
      ['ACTIVA', ACTIVA],
      ['EN_GRACIA', EN_GRACIA],
      ['SUSPENDIDA', SUSPENDIDA],
    ] as const) {
      const filas = await listar(`?estado=${estado}`);
      expect(filas.map((f) => f.sucursalId)).toEqual([sucursalDe(indice).id]);
    }
    const res = await ctx.http().get('/plataforma/suscripciones?estado=OTRO').set(bearer(sa.token));
    expect(res.status).toBe(400);
  });

  it('sin sesión de superadministrador responde 401', async () => {
    expect((await ctx.http().get('/plataforma/suscripciones')).status).toBe(401);
  });

  it('el estado cambia con el reloj de la API', async () => {
    try {
      ctx.reloj.fijar('2030-05-20T23:59:59-05:00');
      const vigente = await nuevoSuperadmin(ctx);
      const antes = await ctx
        .http()
        .get('/plataforma/suscripciones?estado=ACTIVA')
        .set(bearer(vigente.token));
      expect(
        suscripcionResumenSchema
          .array()
          .parse(antes.body)
          .some((f) => f.sucursalId === sucursalDe(ACTIVA).id),
      ).toBe(true);
      ctx.reloj.fijar('2030-05-21T00:00:00-05:00');
      const despues = await ctx
        .http()
        .get('/plataforma/suscripciones?estado=EN_GRACIA')
        .set(bearer(vigente.token));
      const fila = suscripcionResumenSchema
        .array()
        .parse(despues.body)
        .find((f) => f.sucursalId === sucursalDe(ACTIVA).id);
      expect(fila).toMatchObject({ estado: 'EN_GRACIA', diasRestantesGracia: 7 });
    } finally {
      ctx.reloj.fijar(INICIO);
    }
  });

  it('el consumo del mes de Lima actual y del anterior se calcula con la cuota del plan vigente (criterio 79)', async () => {
    const sucursalId = sucursalDe(ACTIVA).id;
    const plan = await crearPlan({ cuotaComprobantesMes: 2, modulos: ['SALON', 'FACTURACION'] });
    exigirEstado(
      await ctx
        .http()
        .patch(`/plataforma/suscripciones/${suscripcionDe(ACTIVA)}`)
        .set(bearer(sa.token))
        .send({ planId: plan.id, motivo: 'Plan con cuota' }),
      200,
      'cambiar de plan',
    );
    // Dos en abril y tres en mayo (hora de Lima: el instante UTC de la medianoche cuenta como el día anterior).
    await emitir(sucursalId, '2030-04-30T23:00:00-05:00');
    await emitir(sucursalId, '2030-05-01T04:59:59Z');
    await emitir(sucursalId, '2030-05-01T05:00:00Z');
    await emitir(sucursalId, '2030-05-10T12:00:00-05:00');
    await emitir(sucursalId, '2030-05-31T23:59:59-05:00');

    const fila = (await listar()).find((f) => f.sucursalId === sucursalId)!;
    expect(fila.consumoMesActual).toEqual({
      periodo: '2030-05',
      emitidos: 3,
      cuota: 2,
      excedente: 1,
    });
    expect(fila.consumoMesAnterior).toEqual({
      periodo: '2030-04',
      emitidos: 2,
      cuota: 2,
      excedente: 0,
    });

    // Una sucursal sin consumo ni cuota: ceros y excedente 0.
    const otra = (await listar()).find((f) => f.sucursalId === sucursalDe(EN_GRACIA).id)!;
    expect(otra.consumoMesActual).toEqual({
      periodo: '2030-05',
      emitidos: 0,
      cuota: null,
      excedente: 0,
    });

    // El excedente usa la cuota del plan en el momento de cada consulta.
    exigirEstado(
      await ctx
        .http()
        .patch(`/plataforma/planes/${plan.id}`)
        .set(bearer(sa.token))
        .send({ cuotaComprobantesMes: 10, motivo: 'Sube la cuota' }),
      200,
      'subir la cuota',
    );
    const subida = (await listar()).find((f) => f.sucursalId === sucursalId)!;
    expect(subida.consumoMesActual).toEqual({
      periodo: '2030-05',
      emitidos: 3,
      cuota: 10,
      excedente: 0,
    });
  });
});

describe('PATCH /plataforma/suscripciones/:id (criterio 74)', () => {
  it('cambia el plan y fija el vencimiento a cualquier fecha, con el antes y el después en la auditoría', async () => {
    const plan = await crearPlan({ diasGracia: 0 });
    const motivo = textoUnico('motivo-ajuste');
    const res = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${suscripcionDe(ACTIVA)}`)
      .set(bearer(sa.token))
      .send({ planId: plan.id, vencimiento: '2030-05-14', motivo });
    exigirEstado(res, 200, 'modificar suscripción');
    const cambiada = suscripcionRespuestaSchema.parse(res.body);
    // Con 0 días de gracia y el vencimiento de ayer, la sucursal pasa a suspendida de inmediato.
    expect(cambiada).toMatchObject({
      id: suscripcionDe(ACTIVA),
      sucursalId: sucursalDe(ACTIVA).id,
      plan: { id: plan.id },
      vencimiento: '2030-05-14',
      estado: 'SUSPENDIDA',
      suspensionDesde: '2030-05-15',
    });
    const filas = await filasDeAuditoria(
      admin,
      "accion = 'modificar_suscripcion' AND motivo = $1",
      [motivo],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      empresa_id: empresa.empresaId,
      sucursal_id: sucursalDe(ACTIVA).id,
      actor_superadministrador_id: sa.id,
      entidad: 'suscripcion',
      entidad_id: suscripcionDe(ACTIVA),
    });
    expect(filas[0]!.detalle).toMatchObject({
      antes: { vencimiento: '2030-05-20' },
      despues: { planId: plan.id, vencimiento: '2030-05-14' },
    });
    // Volver a un vencimiento futuro la reactiva.
    const reactivada = await ctx
      .http()
      .patch(`/plataforma/suscripciones/${suscripcionDe(ACTIVA)}`)
      .set(bearer(sa.token))
      .send({ vencimiento: '2030-12-31', motivo: 'Corrección' });
    exigirEstado(reactivada, 200, 'reactivar');
    expect(reactivada.body).toMatchObject({ estado: 'ACTIVA', plan: { id: plan.id } });
  });

  it('un plan inexistente o inactivo responde 422 PLAN_INVALIDO y no cambia nada', async () => {
    const inactivo = await crearPlan({ activo: false });
    for (const planId of [randomUUID(), inactivo.id]) {
      const res = await ctx
        .http()
        .patch(`/plataforma/suscripciones/${suscripcionDe(EN_GRACIA)}`)
        .set(bearer(sa.token))
        .send({ planId, vencimiento: '2031-01-01', motivo: 'Plan inválido' });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body).toMatchObject({ codigo: 'PLAN_INVALIDO' });
    }
    const { rows } = await admin.query(
      'SELECT vencimiento::text AS v FROM suscripcion WHERE id = $1',
      [suscripcionDe(EN_GRACIA)],
    );
    expect(rows[0].v).toBe('2030-05-10');
  });

  it('una suscripción inexistente responde 404; sin cambios, sin motivo o con campos de más, 400', async () => {
    const motivo = { motivo: 'Prueba' };
    expect(
      (
        await ctx
          .http()
          .patch(`/plataforma/suscripciones/${randomUUID()}`)
          .set(bearer(sa.token))
          .send({ vencimiento: '2031-01-01', ...motivo })
      ).status,
    ).toBe(404);
    for (const cuerpo of [
      motivo,
      { vencimiento: '2031-01-01' },
      { vencimiento: '2031-02-30', ...motivo },
      { empresaId: randomUUID(), vencimiento: '2031-01-01', ...motivo },
    ]) {
      const res = await ctx
        .http()
        .patch(`/plataforma/suscripciones/${suscripcionDe(EN_GRACIA)}`)
        .set(bearer(sa.token))
        .send(cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
  });
});

describe('POST /plataforma/suscripciones/:id/pagos (criterio 73)', () => {
  const pago = (extra: Record<string, unknown> = {}) => ({
    monto: '99.90',
    fechaPago: '2030-05-15',
    medio: 'YAPE',
    referencia: 'Operación 123',
    vencimientoNuevo: '2030-06-30',
    motivo: textoUnico('motivo-pago'),
    ...extra,
  });

  const pagar = (
    id: string,
    cuerpo: Record<string, unknown>,
    clave: string | null = randomUUID(),
  ) => {
    let req = ctx.http().post(`/plataforma/suscripciones/${id}/pagos`).set(bearer(sa.token));
    if (clave !== null) req = req.set('Idempotency-Key', clave);
    return req.send(cuerpo);
  };

  const filasDePago = async (suscripcionId: string) =>
    (
      await admin.query(
        `SELECT monto::text AS monto, fecha_pago::text AS fecha_pago, medio, referencia,
                vencimiento_anterior::text AS anterior, vencimiento_nuevo::text AS nuevo,
                creado_por_superadministrador_id AS sa
           FROM pago_suscripcion WHERE suscripcion_id = $1 ORDER BY creado_en`,
        [suscripcionId],
      )
    ).rows;

  it('registra el pago (201), mueve el vencimiento, reactiva la sucursal suspendida y lo audita (criterio 83)', async () => {
    const id = suscripcionDe(SUSPENDIDA);
    const cuerpo = pago();
    const res = await pagar(id, cuerpo);
    exigirEstado(res, 201, 'registrar pago');
    const r = pagoRegistradoRespuestaSchema.parse(res.body);
    expect(r.pago).toMatchObject({
      suscripcionId: id,
      monto: '99.90',
      fechaPago: '2030-05-15',
      medio: 'YAPE',
      referencia: 'Operación 123',
      vencimientoAnterior: '2030-05-01',
      vencimientoNuevo: '2030-06-30',
    });
    expect(r.suscripcion).toMatchObject({
      id,
      vencimiento: '2030-06-30',
      estado: 'ACTIVA',
    });
    expect(await filasDePago(id)).toEqual([
      {
        monto: '99.90',
        fecha_pago: '2030-05-15',
        medio: 'YAPE',
        referencia: 'Operación 123',
        anterior: '2030-05-01',
        nuevo: '2030-06-30',
        sa: sa.id,
      },
    ]);
    const filas = await filasDeAuditoria(admin, "accion = 'registrar_pago' AND motivo = $1", [
      cuerpo.motivo as string,
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      empresa_id: empresa.empresaId,
      sucursal_id: sucursalDe(SUSPENDIDA).id,
      actor_superadministrador_id: sa.id,
      entidad: 'pago_suscripcion',
      entidad_id: r.pago.id,
    });
    // La lista ya la muestra activa desde la siguiente petición.
    const fila = (await listar()).find((f) => f.sucursalId === sucursalDe(SUSPENDIDA).id)!;
    expect(fila).toMatchObject({ estado: 'ACTIVA', vencimiento: '2030-06-30' });
  });

  it('el vencimiento nuevo debe ser posterior al actual: igual o anterior responde 400 y no guarda nada', async () => {
    const id = suscripcionDe(EN_GRACIA);
    for (const vencimientoNuevo of ['2030-05-10', '2030-05-09']) {
      const motivo = textoUnico('motivo-vencimiento');
      const res = await pagar(id, pago({ vencimientoNuevo, motivo }));
      expect(res.status, vencimientoNuevo).toBe(400);
      expect(JSON.stringify(res.body.campos)).toMatch(/vencimientoNuevo/);
      expect(await filasDeAuditoria(admin, 'motivo = $1', [motivo])).toHaveLength(0);
    }
    expect(await filasDePago(id)).toEqual([]);
  });

  it('la fecha de pago no puede ser posterior a hoy (la de hoy sí)', async () => {
    const id = suscripcionDe(EN_GRACIA);
    const futura = await pagar(id, pago({ fechaPago: '2030-05-16' }));
    expect(futura.status).toBe(400);
    expect(JSON.stringify(futura.body.campos)).toMatch(/fechaPago/);
    // A las 23:30 de Lima ya es 15 de mayo aunque en UTC sea 16.
    ctx.reloj.fijar('2030-05-15T23:30:00-05:00');
    try {
      const vigente = await nuevoSuperadmin(ctx);
      const hoy = await ctx
        .http()
        .post(`/plataforma/suscripciones/${id}/pagos`)
        .set(bearer(vigente.token))
        .send(pago({ fechaPago: '2030-05-15', vencimientoNuevo: '2030-05-12' }));
      exigirEstado(hoy, 201, 'pago de hoy en Lima');
      const manana = await ctx
        .http()
        .post(`/plataforma/suscripciones/${id}/pagos`)
        .set(bearer(vigente.token))
        .send(pago({ fechaPago: '2030-05-16', vencimientoNuevo: '2030-05-13' }));
      expect(manana.status).toBe(400);
    } finally {
      ctx.reloj.fijar(INICIO);
    }
  });

  it.each([
    ['monto cero', { monto: '0' }],
    ['monto 0.00', { monto: '0.00' }],
    ['monto con 3 decimales', { monto: '1.234' }],
    ['monto negativo', { monto: '-5' }],
    ['monto con letras', { monto: 'abc' }],
    ['monto como número', { monto: 50 }],
    ['medio desconocido', { medio: 'BITCOIN' }],
    ['referencia de más de 100 caracteres', { referencia: 'x'.repeat(101) }],
    ['fecha inexistente', { fechaPago: '2030-02-30' }],
    ['sin motivo', { motivo: undefined }],
    ['campo desconocido', { empresaId: randomUUID() }],
  ])('%s responde 400 y no guarda nada', async (_nombre, extra) => {
    const id = suscripcionDe(EN_GRACIA);
    const antes = await filasDePago(id);
    const res = await pagar(id, pago(extra));
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await filasDePago(id)).toEqual(antes);
  });

  it('una suscripción inexistente responde 404 y sin sesión de superadministrador, 401', async () => {
    expect((await pagar(randomUUID(), pago())).status).toBe(404);
    const sinSesion = await ctx
      .http()
      .post(`/plataforma/suscripciones/${suscripcionDe(EN_GRACIA)}/pagos`)
      .send(pago());
    expect(sinSesion.status).toBe(401);
  });

  it('con la misma Idempotency-Key y el mismo cuerpo devuelve lo mismo sin repetir el pago ni la auditoría (criterio 85)', async () => {
    const id = suscripcionDe(ACTIVA);
    const antes = (await filasDePago(id)).length;
    const clave = randomUUID();
    const cuerpo = pago({ vencimientoNuevo: '2031-01-31' });
    const primero = await pagar(id, cuerpo, clave);
    exigirEstado(primero, 201, 'primer pago');
    const segundo = await pagar(id, cuerpo, clave);
    exigirEstado(segundo, 201, 'pago repetido');
    expect(segundo.body).toEqual(primero.body);
    expect(await filasDePago(id)).toHaveLength(antes + 1);
    expect(
      await filasDeAuditoria(admin, "accion = 'registrar_pago' AND motivo = $1", [
        cuerpo.motivo as string,
      ]),
    ).toHaveLength(1);
  });

  it('la misma clave con otro cuerpo, o en otra suscripción, responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const clave = randomUUID();
    const cuerpo = pago({ vencimientoNuevo: '2031-02-28' });
    exigirEstado(await pagar(suscripcionDe(ACTIVA), cuerpo, clave), 201, 'primer pago');
    const otroCuerpo = await pagar(suscripcionDe(ACTIVA), { ...cuerpo, monto: '10.00' }, clave);
    expect(otroCuerpo.status).toBe(422);
    expect(otroCuerpo.body).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
    const otraSuscripcion = await pagar(suscripcionDe(EN_GRACIA), cuerpo, clave);
    expect(otraSuscripcion.status).toBe(422);
    expect(otraSuscripcion.body).toMatchObject({ codigo: 'CLAVE_IDEMPOTENCIA_REUTILIZADA' });
  });

  it('pagos concurrentes por el mismo vencimiento: solo uno se acepta (la suscripción se bloquea)', async () => {
    const id = suscripcionDe(EN_GRACIA);
    const antes = (await filasDePago(id)).length;
    const respuestas = await Promise.all(
      Array.from({ length: 4 }, () => pagar(id, pago({ vencimientoNuevo: '2032-03-31' }))),
    );
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados, JSON.stringify(respuestas.map((r) => r.body))).toEqual([201, 400, 400, 400]);
    expect(await filasDePago(id)).toHaveLength(antes + 1);
  });
});
