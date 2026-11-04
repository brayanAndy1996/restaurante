// spec: 006-caja-cobro (pruebas protegidas)
//
// P3 · Turno de caja (ruta crítica), criterios 24 a 28:
// - 24: abrir un turno con fondo (`POST /turnos`), réplica por `id` y `CLAVE_IDEMPOTENCIA_REUTILIZADA`; la sesión de
//   soporte no abre turnos (un turno es de una persona);
// - 25: la suspensión impide abrir (403 SUCURSAL_SUSPENDIDA) pero no corta un turno abierto; EN_GRACIA abre igual;
// - 26: un turno abierto por caja y uno por persona en la sucursal, también con aperturas simultáneas;
// - 27: `GET /turnos/mio`, `GET /cajas` (sin montos) y `GET /turnos/:id` con el alcance del Cajero;
// - 28: ingresos y egresos (siempre en efectivo, sin clave), solo en un turno abierto y por su responsable o un
//   Supervisor/Administrador.
// El reporte X y el cierre Z están en `cierre.spec.ts`.
// Hoy falla por "No implementado": las rutas de caja responden 500 sin `@Permiso`.
import { turnoRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  abrirTurno,
  abrirTurnoCrudo,
  api,
  arrancarCaja,
  cerrarAdmin,
  cerrarTurnoCrudo,
  cobrar,
  conteo,
  crearCaja,
  crearEscenario,
  cuentaC,
  escribir,
  esperarError,
  eventosDe,
  exigirEstado,
  filas,
  sesionContrasena,
  type AppP5,
  type Escenario,
} from './fabrica-caja';
import { sesionDeSoporte } from '../acceso/fabrica-equipos';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

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

const MOTIVOS = { EFECTIVO: 'x', TARJETA_CREDITO: 'x', TARJETA_DEBITO: 'x', YAPE: 'x', PLIN: 'x' };
const turnosAbiertosDe = async (cajaId: string) =>
  (await filas(`SELECT id FROM turno WHERE caja_id = $1 AND estado = 'ABIERTO'`, [cajaId])).length;

describe('criterio 24 · abrir', () => {
  it('abre el turno con su fondo y responde la forma de turnoRespuesta', async () => {
    const cajas = await A().cajas();
    const id = randomUUID();
    const res = await abrirTurnoCrudo(ctx, A().token.cajero!, cajas.S1!.caja1, '200.00', id);
    exigirEstado(res, 201, 'Abrir el turno (006, criterio 24)');
    const turno = turnoRespuestaSchema.parse(res.body);
    expect(turno).toMatchObject({
      id,
      caja: { id: cajas.S1!.caja1, nombre: 'Caja 1' },
      responsable: { id: A().personas.cajero!.id },
      estado: 'ABIERTO',
      diaOperativo: '2026-11-02',
      fondo: '200.00',
      cerradoEn: null,
      cerradoPor: null,
    });
    expect(turno.abiertoEn).toBe(ctx.reloj.ahora().toISOString());
    await cerrarSiAbierto(id, A().token.cajero!);
  });

  it('repetir el mismo id devuelve el turno sin crear otro; con otra caja u otro fondo, 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const cajas = await A().cajas();
    const id = randomUUID();
    const primera = await abrirTurnoCrudo(ctx, A().token.cajero2!, cajas.S1!.caja2, '50.00', id);
    exigirEstado(primera, 201, 'Abrir el turno');
    const otra = await abrirTurnoCrudo(ctx, A().token.cajero2!, cajas.S1!.caja2, '50.00', id);
    expect([200, 201], otra.text).toContain(otra.status);
    expect(otra.body).toEqual(primera.body);
    expect(await turnosAbiertosDe(cajas.S1!.caja2)).toBe(1);
    esperarError(
      await abrirTurnoCrudo(ctx, A().token.cajero2!, cajas.S1!.caja2, '60.00', id),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    esperarError(
      await abrirTurnoCrudo(ctx, A().token.cajero2!, cajas.S1!.caja3, '50.00', id),
      422,
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    await cerrarSiAbierto(primera.body.id, A().token.cajero2!);
  });

  it('una caja inactiva responde 409 CONFLICTO; una caja de otra sucursal, de B o inexistente, 404', async () => {
    const cajas = await A().cajas();
    const extra = await crearCaja(ctx, A().token.admin!, A().S1, 'Caja inactiva');
    exigirEstado(
      await api(ctx, A().token.admin, 'patch', `/sucursales/${A().S1}/cajas/${extra.id}`, {
        activa: false,
      }),
      200,
      'Desactivar la caja (006, criterio 1)',
    );
    esperarError(
      await abrirTurnoCrudo(ctx, A().token.supervisor!, extra.id as string, '10.00'),
      409,
      'CONFLICTO',
    );
    const cajasB = await esc.B.cajas();
    for (const cajaId of [cajas.S2!.caja1, cajasB.S1!.caja1, randomUUID()]) {
      const res = await abrirTurnoCrudo(ctx, A().token.supervisor!, cajaId, '10.00');
      expect(res.status, res.text).toBe(404);
    }
  });

  it('el fondo fuera de rango es 400 y un Mozo recibe 403 PROHIBIDO', async () => {
    const cajas = await A().cajas();
    esperarError(
      await abrirTurnoCrudo(ctx, A().token.supervisor!, cajas.S1!.caja3, '100000000.00'),
      400,
      'DATOS_INVALIDOS',
    );
    esperarError(
      await abrirTurnoCrudo(ctx, A().token.mozo!, cajas.S1!.caja3, '10.00'),
      403,
      'PROHIBIDO',
    );
    expect(await turnosAbiertosDe(cajas.S1!.caja3)).toBe(0);
  });

  it('una sesión de soporte no abre turnos: 422 REFERENCIA_INVALIDA', async () => {
    const cajas = await A().cajas();
    const soporte = await sesionDeSoporte(ctx.app, esc.sa.token, A().id, A().S1);
    esperarError(
      await abrirTurnoCrudo(ctx, soporte, cajas.S1!.caja3, '10.00'),
      422,
      'REFERENCIA_INVALIDA',
    );
    expect(await turnosAbiertosDe(cajas.S1!.caja3)).toBe(0);
  });
});

/** Cierra un turno propio ignorando si ya estaba cerrado (limpieza entre pruebas). */
async function cerrarSiAbierto(turnoId: string, token: string): Promise<void> {
  await cerrarTurnoCrudo(ctx, token, turnoId, conteo({}, MOTIVOS));
}

describe('criterio 25 · suspensión', () => {
  const vencimiento = (sucursalId: string, fecha: string) =>
    api(
      ctx,
      esc.sa.token,
      'patch',
      `/plataforma/suscripciones/${A().base.suscripciones[sucursalId]!.id}`,
      {
        vencimiento: fecha,
        motivo: 'Prueba de suspensión',
      },
    );

  it('con la sucursal SUSPENDIDA no se abre caja (403 SUCURSAL_SUSPENDIDA) y no queda turno', async () => {
    const cajas = await A().cajas();
    exigirEstado(await vencimiento(A().S3, '2026-10-01'), 200, 'Vencer la suscripción de S3 (002)');
    const res = await abrirTurnoCrudo(ctx, A().token.cajeroS3!, cajas.S3!.caja1, '10.00');
    esperarError(res, 403, 'SUCURSAL_SUSPENDIDA');
    expect(await turnosAbiertosDe(cajas.S3!.caja1)).toBe(0);
  });

  it('en gracia se abre igual', async () => {
    const cajas = await A().cajas();
    exigirEstado(await vencimiento(A().S4!, '2026-10-28'), 200, 'Poner S4 en gracia (002)');
    const id = await abrirTurno(ctx, A().token.supervisorS4!, cajas.S4!.caja1, '10.00');
    expect(id).toBeTruthy();
  });

  it('un turno abierto sigue cobrando y se cierra aunque la sucursal pase a SUSPENDIDA', async () => {
    const cajas = await A().cajas();
    const turnoId = await abrirTurno(ctx, A().token.supervisorS2!, cajas.S2!.caja1, '100.00');
    const cuenta = await cuentaC(ctx, A(), 'S2');
    exigirEstado(await vencimiento(A().S2, '2026-10-01'), 200, 'Vencer la suscripción de S2 (002)');
    const cobro = await cobrar(ctx, A().token.supervisorS2!, cuenta, { turnoId, total: '69.20' });
    expect(cobro.cuenta.estado).toBe('CERRADA');
    const cierre = await cerrarTurnoCrudo(
      ctx,
      A().token.supervisorS2!,
      turnoId,
      conteo({ EFECTIVO: '169.20' }, MOTIVOS),
    );
    exigirEstado(cierre, 200, 'Cerrar el turno con la sucursal suspendida (006, criterio 25)');
    // La siguiente apertura sí se rechaza.
    esperarError(
      await abrirTurnoCrudo(ctx, A().token.supervisorS2!, cajas.S2!.caja1, '10.00'),
      403,
      'SUCURSAL_SUSPENDIDA',
    );
  });
});

describe('criterio 26 · uno por caja y uno por persona', () => {
  /** Cierra los turnos abiertos de las cajas dadas (limpieza entre carreras). */
  async function cerrarLosAbiertosDe(cajaIds: string[]): Promise<void> {
    const tokens: Record<string, string> = {
      [A().personas.cajero!.id]: A().token.cajero!,
      [A().personas.cajero2!.id]: A().token.cajero2!,
      [A().personas.supervisor!.id]: A().token.supervisor!,
    };
    const abiertos = await filas(
      `SELECT id, responsable_id FROM turno WHERE estado = 'ABIERTO' AND caja_id = ANY($1::uuid[])`,
      [cajaIds],
    );
    for (const t of abiertos)
      await cerrarSiAbierto(t.id as string, tokens[t.responsable_id as string]!);
  }

  it('una persona que abre a la vez en dos cajas distintas termina con un solo turno abierto', async () => {
    const x = (await crearCaja(ctx, A().token.admin!, A().S1, 'Caja 6')).id as string;
    const y = (await crearCaja(ctx, A().token.admin!, A().S1, 'Caja 7')).id as string;
    const [a, b] = await Promise.all([
      abrirTurnoCrudo(ctx, A().token.supervisor!, x, '10.00'),
      abrirTurnoCrudo(ctx, A().token.supervisor!, y, '10.00'),
    ]);
    expect([a.status, b.status].sort(), `${a.text} | ${b.text}`).toEqual([201, 409]);
    expect((a.status === 409 ? a : b).body.codigo).toBe('TURNO_YA_ABIERTO');
    const abiertos = await filas(
      `SELECT id FROM turno WHERE estado = 'ABIERTO' AND responsable_id = $1`,
      [A().personas.supervisor!.id],
    );
    expect(abiertos).toHaveLength(1);
    await cerrarLosAbiertosDe([x, y]);
  });

  it('dos personas abriendo a la vez la misma caja: una 201 y otra 409, y nunca dos turnos abiertos', async () => {
    const nueva = (await crearCaja(ctx, A().token.admin!, A().S1, 'Caja 5')).id as string;
    const [a, b] = await Promise.all([
      abrirTurnoCrudo(ctx, A().token.cajero!, nueva, '10.00'),
      abrirTurnoCrudo(ctx, A().token.cajero2!, nueva, '10.00'),
    ]);
    expect([a.status, b.status].sort(), `${a.text} | ${b.text}`).toEqual([201, 409]);
    expect((a.status === 409 ? a : b).body.codigo).toBe('TURNO_YA_ABIERTO');
    expect(await turnosAbiertosDe(nueva)).toBe(1);
    await cerrarLosAbiertosDe([nueva]);
  });

  it('dos aperturas simultáneas con ids distintos en la misma caja: una 201 y otra 409', async () => {
    const nueva = (await crearCaja(ctx, A().token.admin!, A().S1, 'Caja 4')).id as string;
    const [a, b] = await Promise.all([
      abrirTurnoCrudo(ctx, A().token.supervisor!, nueva, '10.00'),
      abrirTurnoCrudo(ctx, A().token.supervisor!, nueva, '10.00'),
    ]);
    expect([a.status, b.status].sort(), `${a.text} | ${b.text}`).toEqual([201, 409]);
    expect(await turnosAbiertosDe(nueva)).toBe(1);
    await cerrarLosAbiertosDe([nueva]);
  });

  it('abrir en una caja ocupada responde 409 TURNO_YA_ABIERTO con el turnoId; las otras cajas abren a la vez', async () => {
    const cajas = await A().cajas();
    const primero = await abrirTurno(ctx, A().token.cajero!, cajas.S1!.caja1);
    const res = await abrirTurnoCrudo(ctx, A().token.supervisor!, cajas.S1!.caja1, '10.00');
    esperarError(res, 409, 'TURNO_YA_ABIERTO');
    expect(res.body.turnoId).toBe(primero);
    const otraCaja = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
    expect(otraCaja).toBeTruthy();
    expect(await turnosAbiertosDe(cajas.S1!.caja1)).toBe(1);
  });

  it('una persona con un turno abierto no abre otro en otra caja de la sucursal: 409 TURNO_YA_ABIERTO con el suyo', async () => {
    const cajas = await A().cajas();
    const [propio] = await filas(`SELECT id FROM turno WHERE caja_id = $1 AND estado = 'ABIERTO'`, [
      cajas.S1!.caja1,
    ]);
    const res = await abrirTurnoCrudo(ctx, A().token.cajero!, cajas.S1!.caja3, '10.00');
    esperarError(res, 409, 'TURNO_YA_ABIERTO');
    expect(res.body.turnoId).toBe(propio!.id);
    expect(await turnosAbiertosDe(cajas.S1!.caja3)).toBe(0);
  });
});

describe('criterio 27 · consultar', () => {
  it('GET /turnos/mio responde el turno abierto de la persona o 404; GET /cajas lista las cajas sin montos', async () => {
    const mio = await api(ctx, A().token.cajero!, 'get', '/turnos/mio');
    exigirEstado(mio, 200, 'GET /turnos/mio (006, criterio 27)');
    expect(mio.body).toMatchObject({
      estado: 'ABIERTO',
      responsable: { id: A().personas.cajero!.id },
    });
    // Un Cajero sin turno abierto recibe 404.
    const sinTurno = await api(ctx, A().token.cajero2!, 'get', '/turnos/mio');
    if (sinTurno.status === 200)
      await cerrarSiAbierto(sinTurno.body.id as string, A().token.cajero2!);
    const otra = await api(ctx, A().token.cajero2!, 'get', '/turnos/mio');
    expect(otra.status).toBe(404);

    const lista = await api(ctx, A().token.cajero!, 'get', '/cajas');
    exigirEstado(lista, 200, 'GET /cajas');
    const cajas = lista.body as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(cajas.length).toBeGreaterThanOrEqual(3);
    const conTurno = cajas.find((c) => c.turnoAbierto !== null)!;
    expect(conTurno.turnoAbierto).toHaveProperty('responsable');
    expect(conTurno.turnoAbierto).toHaveProperty('abiertoEn');
    expect(JSON.stringify(lista.body)).not.toMatch(/fondo|esperado|monto/i);
  });

  it('GET /turnos/:id: el responsable y el Supervisor lo ven; otro Cajero recibe 403; de B o inexistente, 404', async () => {
    const [turno] = await filas(
      `SELECT id FROM turno WHERE estado = 'ABIERTO' AND responsable_id = $1`,
      [A().personas.cajero!.id],
    );
    const id = turno!.id as string;
    exigirEstado(
      await api(ctx, A().token.cajero!, 'get', `/turnos/${id}`),
      200,
      'El responsable ve su turno',
    );
    exigirEstado(
      await api(ctx, A().token.supervisor!, 'get', `/turnos/${id}`),
      200,
      'El Supervisor ve cualquier turno',
    );
    esperarError(await api(ctx, A().token.cajero2!, 'get', `/turnos/${id}`), 403, 'PROHIBIDO');
    expect((await api(ctx, A().token.cajero!, 'get', `/turnos/${randomUUID()}`)).status).toBe(404);
    expect((await api(ctx, esc.B.token.cajero!, 'get', `/turnos/${id}`)).status).toBe(404);
  });
});

describe('criterio 28 · ingresos y egresos', () => {
  async function turnoPropio() {
    const [t] = await filas(
      `SELECT id FROM turno WHERE estado = 'ABIERTO' AND responsable_id = $1`,
      [A().personas.cajero!.id],
    );
    return t!.id as string;
  }
  const mov = (token: string, turnoId: string, o: Record<string, unknown> = {}) =>
    escribir(ctx, token, 'post', `/turnos/${turnoId}/movimientos`, {
      id: randomUUID(),
      tipo: 'INGRESO',
      monto: '20.00',
      motivo: 'Cambio de billetes',
      ...o,
    });

  it('registra un ingreso y un egreso en efectivo y responde la forma del movimiento', async () => {
    const turnoId = await turnoPropio();
    const res = await mov(A().token.cajero!, turnoId, {
      tipo: 'EGRESO',
      monto: '15.50',
      motivo: 'Compra de hielo',
    });
    exigirEstado(res, 201, 'Registrar el egreso (006, criterio 28)');
    expect(res.body).toMatchObject({ tipo: 'EGRESO', monto: '15.50', motivo: 'Compra de hielo' });
    expect(res.body.creadoPor).toMatchObject({ id: A().personas.cajero!.id });
    const [fila] = await filas('SELECT medio FROM movimiento_caja WHERE id = $1', [res.body.id]);
    expect(fila!.medio).toBe('EFECTIVO');
  });

  it('repetir el mismo id devuelve el movimiento sin registrar otro', async () => {
    const turnoId = await turnoPropio();
    const id = randomUUID();
    const a = await mov(A().token.cajero!, turnoId, { id });
    const b = await mov(A().token.cajero!, turnoId, { id });
    expect(a.status).toBe(201);
    expect([200, 201]).toContain(b.status);
    expect(b.body).toEqual(a.body);
    expect(await filas('SELECT 1 FROM movimiento_caja WHERE id = $1', [id])).toHaveLength(1);
  });

  it('un Supervisor registra en el turno ajeno; otro Cajero recibe 409 TURNO_AJENO; un Mozo, 403', async () => {
    const turnoId = await turnoPropio();
    exigirEstado(
      await mov(A().token.supervisor!, turnoId),
      201,
      'El Supervisor registra en el turno del Cajero',
    );
    esperarError(await mov(A().token.cajero2!, turnoId), 409, 'TURNO_AJENO');
    esperarError(await mov(A().token.mozo!, turnoId), 403, 'PROHIBIDO');
  });

  it('un egreso mayor que el efectivo se acepta; un monto de 0.00 o sin motivo es 400', async () => {
    const turnoId = await turnoPropio();
    exigirEstado(
      await mov(A().token.cajero!, turnoId, { tipo: 'EGRESO', monto: '90000.00' }),
      201,
      'Egreso mayor que el efectivo',
    );
    esperarError(await mov(A().token.cajero!, turnoId, { monto: '0.00' }), 400, 'DATOS_INVALIDOS');
    esperarError(await mov(A().token.cajero!, turnoId, { motivo: '' }), 400, 'DATOS_INVALIDOS');
    esperarError(await mov(A().token.cajero!, turnoId, { medio: 'YAPE' }), 400, 'DATOS_INVALIDOS');
  });

  it('en un turno cerrado responde 409 TURNO_CERRADO', async () => {
    const cajas = await A().cajas();
    const t = await abrirTurno(ctx, A().token.cajero2!, cajas.S1!.caja2);
    exigirEstado(
      await cerrarTurnoCrudo(ctx, A().token.cajero2!, t, conteo({ EFECTIVO: '200.00' }, MOTIVOS)),
      200,
      'Cerrar',
    );
    esperarError(await mov(A().token.cajero2!, t), 409, 'TURNO_CERRADO');
    expect(eventosDe(ctx, 'turno.cambio').length).toBeGreaterThan(0);
    void sesionContrasena;
  });
});
