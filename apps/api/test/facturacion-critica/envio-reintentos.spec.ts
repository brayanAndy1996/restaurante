// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · Reintentos con espera creciente, plazos y reintento manual (ruta crítica), criterios 126, 129, 130 y 132:
// - 129: después de un intento que no termina el envío (`ERROR_TRANSPORTE`, `ERROR_CONFIGURACION` o `PENDIENTE`) el
//   siguiente cae 1, 2, 5, 15, 30 y luego cada 60 minutos más tarde (con `RelojManual` y el barrido a mano), sin intentarse
//   antes de `proximo_intento_en`; el último, justo en `plazo_hasta` si el siguiente caería después;
// - 126: el barrido no vuelve a encolar lo que no toca ni lo que tiene un arriendo vigente;
// - 130: el envío que llega a su plazo sin respuesta final queda `DETENIDO` y no se reintenta solo; el reintento manual lo
//   reactiva igual;
// - 132: `POST /facturacion/comprobantes/:id/reintento` (IK, sin cuerpo): 202 `envioRespuesta`, `ENVIO_TERMINADO` en un
//   envío `TERMINADO`, 202 sin cambios con un arriendo vigente, sin auditoría;
// - un `RECHAZADO` o un `ACEPTADO` nunca se reintentan.
// Hoy falla porque `envio_pse` no existe y el procesador, el barrido y las rutas responden «No implementado».
import { envioPseRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrancarFact,
  api,
  avanzar,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  contar,
  crearEscenarioFact,
  envioDe,
  escribir,
  exigirEstado,
  exigirPse,
  finDelDiaLima,
  idPse,
  fechaEmisionDe,
  intentosDe,
  limitarBarrido,
  procesar,
  procesarCola,
  turnoDe,
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
/** Cuándo (hora de la API) se abrieron por última vez las sesiones: expiran a los 30 minutos. */
let sesionesDesde = 0;
beforeEach(async () => {
  await exigirPse(esc);
  if (ctx.reloj.ahora().getTime() - sesionesDesde > 5 * MIN) {
    await esc.A.refrescarSesiones();
    await esc.B.refrescarSesiones();
    sesionesDesde = ctx.reloj.ahora().getTime();
  }
  ctx.pse.reglas.limpiar();
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

async function nuevoCobro(): Promise<Cobrado> {
  const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
  return cobrarLomo(ctx, A(), { turnoId });
}
const trabajosDe = (comprobanteId: string) =>
  ctx.cola.pendientes().filter((t) => t.comprobanteId === comprobanteId);
const proximoDe = async (id: string): Promise<number> =>
  new Date((await envioDe(id))!.proximo_intento_en as string).getTime();
/** Las llamadas al PSE de estos comprobantes: el barrido también manda los envíos pendientes de otras pruebas. */
async function llamadasDe(...comprobanteIds: string[]) {
  const ids = await Promise.all(comprobanteIds.map((c) => idPse(c)));
  return ctx.pse
    .llamadas()
    .filter((l) =>
      ids.some(
        (id) =>
          id.rucEmisor === l.id.rucEmisor &&
          id.tipoSunat === l.id.tipoSunat &&
          id.serie === l.id.serie &&
          id.numero === l.id.numero,
      ),
    );
}
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Una vuelta del worker: el barrido y los trabajos vencidos de la cola. */
async function vuelta(): Promise<void> {
  await ctx.barrido.barrerAhora();
  await procesarCola(ctx, [A().id, esc.B.id]);
}

const MIN = 60_000;

describe('criterio 129 · espera creciente con el reloj y el barrido', () => {
  it('ejemplo del criterio: errores de transporte a los 0, 1, 3, 8, 23 y 53 minutos; luego 113, 173 y 233 minutos', async () => {
    ctx.pse.reglas.fallarTransmision(100);
    const c = await nuevoCobro();
    const t0 = ctx.reloj.ahora().getTime();
    // Minutos desde la emisión en que cae cada intento.
    const momentos = [0, 1, 3, 8, 23, 53, 113, 173, 233];
    // Intento 1: el trabajo recién encolado.
    await procesarCola(ctx, [A().id]);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
    for (let n = 2; n <= momentos.length - 1; n++) {
      const toca = t0 + momentos[n - 1]! * MIN;
      expect(
        await proximoDe(c.comprobanteId),
        `proximo_intento_en después del intento ${n - 1}`,
      ).toBe(toca);
      // Un segundo antes de tocar, ni el barrido ni la cola llaman al PSE.
      ctx.reloj.fijar(toca - 1000);
      const llamadas = (await llamadasDe(c.comprobanteId)).length;
      await vuelta();
      expect(
        await llamadasDe(c.comprobanteId),
        `no se intenta antes de tiempo (intento ${n})`,
      ).toHaveLength(llamadas);
      expect((await envioDe(c.comprobanteId))!.intentos).toBe(n - 1);
      // A la hora, el intento n.
      ctx.reloj.fijar(toca);
      await vuelta();
      const envio = (await envioDe(c.comprobanteId))!;
      expect(envio.intentos, `intentos a los ${momentos[n - 1]} minutos`).toBe(n);
      expect(envio).toMatchObject({
        estado: 'PENDIENTE',
        ultimo_resultado: 'ERROR_TRANSPORTE',
        en_curso_hasta: null,
      });
    }
    expect(await proximoDe(c.comprobanteId)).toBe(t0 + momentos[momentos.length - 1]! * MIN);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');
    // Un intento por llamada: emitir el primero y consultar los demás.
    expect((await llamadasDe(c.comprobanteId)).map((l) => l.operacion)).toEqual([
      'emitir',
      ...Array.from({ length: 7 }, () => 'consultar'),
    ]);
  });

  it('PENDIENTE y ERROR_CONFIGURACION usan la misma tabla de esperas (1, 2, 5…) y no se intenta antes', async () => {
    ctx.pse.reglas.responderPendiente(2);
    const c = await nuevoCobro();
    const t0 = ctx.reloj.ahora().getTime();
    await procesarCola(ctx, [A().id]);
    expect(await proximoDe(c.comprobanteId)).toBe(t0 + 1 * MIN); // después del intento 1: 1 minuto.
    ctx.reloj.fijar(t0 + 1 * MIN);
    await vuelta();
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(2);
    expect(await proximoDe(c.comprobanteId)).toBe(t0 + 3 * MIN); // intento 2: 2 minutos.

    ctx.pse.reglas.errorDeConfiguracion(1);
    ctx.reloj.fijar(t0 + 3 * MIN);
    await vuelta();
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      intentos: 3,
      ultimo_resultado: 'ERROR_CONFIGURACION',
    });
    expect(await proximoDe(c.comprobanteId)).toBe(t0 + 8 * MIN); // intento 3: 5 minutos.
    // Al fin acepta (pendiente agotado).
    ctx.reloj.fijar(t0 + 8 * MIN);
    await vuelta();
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
  });

  it('el siguiente intento no pasa de plazo_hasta: si caería después, se intenta justo en plazo_hasta', async () => {
    ctx.pse.reglas.fallarTransmision(1000);
    const c = await nuevoCobro();
    const plazo = finDelDiaLima(await fechaEmisionDe(c.comprobanteId), 3).getTime();
    await procesarCola(ctx, [A().id]);
    // Seis intentos seguidos, cada uno a su hora: desde el sexto la espera es de 60 minutos.
    for (let n = 2; n <= 6; n++) {
      ctx.reloj.fijar(await proximoDe(c.comprobanteId));
      await vuelta();
    }
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(6);
    // Un séptimo intento a 30 minutos del plazo: el siguiente tocaría 60 minutos después, o sea pasado el plazo.
    ctx.reloj.fijar(plazo - 30 * MIN);
    await vuelta();
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(7);
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio.estado).toBe('PENDIENTE');
    expect(new Date(envio.plazo_hasta as string).getTime()).toBe(plazo);
    expect(await proximoDe(c.comprobanteId)).toBe(plazo);
  });
});

describe('criterio 126 · el barrido solo encola lo que toca', () => {
  it('no encola un envío cuyo próximo intento es futuro; sí cuando llega la hora', async () => {
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro();
    await procesarCola(ctx, [A().id]);
    ctx.cola.vaciar();
    ctx.reloj.avanzar(30_000);
    await ctx.barrido.barrerAhora();
    expect(trabajosDe(c.comprobanteId)).toEqual([]);
    ctx.reloj.avanzar(30_000);
    const resultado = await ctx.barrido.barrerAhora();
    expect(resultado.reencolados).toBeGreaterThanOrEqual(1);
    expect(trabajosDe(c.comprobanteId).length).toBeGreaterThanOrEqual(1);
  });

  it('no encola un envío con un arriendo vigente', async () => {
    ctx.pse.reglas.demorar(1500);
    const c = await nuevoCobro();
    ctx.cola.vaciar();
    const en_curso = procesar(ctx, A().id, c.comprobanteId);
    en_curso.catch(() => undefined); // si la prueba falla antes de esperarlo, que no quede un rechazo sin atender
    let envio: Libre | undefined;
    for (let i = 0; i < 40 && !envio?.en_curso_hasta; i++) {
      await dormir(50);
      envio = await envioDe(c.comprobanteId);
    }
    expect(envio?.en_curso_hasta).toBeTruthy();
    await ctx.barrido.barrerAhora();
    expect(trabajosDe(c.comprobanteId)).toEqual([]);
    await en_curso;
  });

  it('un envío TERMINADO (aceptado o rechazado) no se encola ni se reintenta nunca', async () => {
    const aceptado = await nuevoCobro();
    const rechazado = await nuevoCobro();
    const numero = (rechazado.respuesta.comprobante as { numero: string }).numero;
    ctx.pse.reglas.rechazarNumero(numero, { codigo: '2800', mensaje: 'Rechazo de prueba' });
    await procesarCola(ctx, [A().id]);
    expect((await comprobanteFila(aceptado.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await comprobanteFila(rechazado.comprobanteId)).estado).toBe('RECHAZADO');
    ctx.cola.vaciar();
    // Solo cuentan las llamadas de estos dos documentos.
    const deEstos = () => llamadasDe(aceptado.comprobanteId, rechazado.comprobanteId);
    const llamadas = (await deEstos()).length;
    expect(llamadas).toBe(2);
    for (const dias of [1, 2]) {
      ctx.reloj.avanzar(dias * 24 * 60 * MIN);
      await ctx.barrido.barrerAhora();
      await procesarCola(ctx, [A().id]);
    }
    expect(trabajosDe(aceptado.comprobanteId)).toEqual([]);
    expect(trabajosDe(rechazado.comprobanteId)).toEqual([]);
    expect(await deEstos()).toHaveLength(llamadas);
    expect(await intentosDe(aceptado.comprobanteId)).toHaveLength(1);
    expect(await intentosDe(rechazado.comprobanteId)).toHaveLength(1);
    await esc.A.refrescarSesiones();
  });
});

describe('criterio 132 · reintento manual', () => {
  const reintentar = (id: string, token = A().token.supervisor) =>
    escribir(ctx, token, 'post', `/facturacion/comprobantes/${id}/reintento`);

  it('adelanta un envío que espera: proximo_intento_en = ahora, 202 con envioRespuesta, se encola y el procesador lo envía', async () => {
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro();
    await procesarCola(ctx, [A().id]);
    expect(await proximoDe(c.comprobanteId)).toBe(ctx.reloj.ahora().getTime() + MIN);
    ctx.cola.vaciar();
    const auditoriaAntes = await contar('SELECT 1 FROM auditoria WHERE empresa_id = $1', [A().id]);

    const res = await reintentar(c.comprobanteId);
    exigirEstado(res, 202, 'Reintento manual (006, criterio 132)');
    const cuerpo = envioPseRespuestaSchema.parse(res.body);
    expect(cuerpo).toMatchObject({ estado: 'PENDIENTE', intentos: 1 });
    expect(new Date(cuerpo.proximoIntentoEn!).getTime()).toBe(ctx.reloj.ahora().getTime());
    expect(await proximoDe(c.comprobanteId)).toBe(ctx.reloj.ahora().getTime());
    expect(trabajosDe(c.comprobanteId).length).toBeGreaterThanOrEqual(1);
    // No se audita (queda en la trazabilidad de envio_pse).
    expect(await contar('SELECT 1 FROM auditoria WHERE empresa_id = $1', [A().id])).toBe(
      auditoriaAntes,
    );

    await procesarCola(ctx, [A().id]);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(2);
  });

  it('un envío TERMINADO responde 409 ENVIO_TERMINADO, aceptado o rechazado, sin cambiar nada', async () => {
    const aceptado = await nuevoCobro();
    await procesar(ctx, A().id, aceptado.comprobanteId);
    const rechazado = await nuevoCobro();
    ctx.pse.reglas.rechazarNumero((rechazado.respuesta.comprobante as { numero: string }).numero, {
      codigo: '2800',
      mensaje: 'Rechazo de prueba',
    });
    await procesar(ctx, A().id, rechazado.comprobanteId);
    ctx.cola.vaciar();
    for (const c of [aceptado, rechazado]) {
      const antes = await envioDe(c.comprobanteId);
      const res = await reintentar(c.comprobanteId);
      expect(res.status, res.text).toBe(409);
      expect(res.body.codigo).toBe('ENVIO_TERMINADO');
      expect(await envioDe(c.comprobanteId)).toEqual(antes);
      expect(trabajosDe(c.comprobanteId)).toEqual([]);
    }
  });

  it('con un arriendo vigente responde 202 sin cambios', async () => {
    ctx.pse.reglas.demorar(1500);
    const c = await nuevoCobro();
    const en_curso = procesar(ctx, A().id, c.comprobanteId);
    en_curso.catch(() => undefined); // si la prueba falla antes de esperarlo, que no quede un rechazo sin atender
    let antes: Libre | undefined;
    for (let i = 0; i < 40 && !antes?.en_curso_hasta; i++) {
      await dormir(50);
      antes = await envioDe(c.comprobanteId);
    }
    expect(antes?.en_curso_hasta).toBeTruthy();
    ctx.cola.vaciar();
    const res = await reintentar(c.comprobanteId);
    exigirEstado(res, 202, 'Reintento con un arriendo vigente');
    envioPseRespuestaSchema.parse(res.body);
    const despues = (await envioDe(c.comprobanteId))!;
    expect(despues.estado).toBe(antes!.estado);
    expect(despues.intentos).toBe(antes!.intentos);
    expect(despues.proximo_intento_en).toEqual(antes!.proximo_intento_en);
    expect(despues.intento_en_curso).toBe(antes!.intento_en_curso);
    await en_curso;
  });

  it('sin Idempotency-Key responde 400 (como las demás escrituras) y no cambia el envío ni encola', async () => {
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro();
    await procesarCola(ctx, [A().id]);
    ctx.cola.vaciar();
    const antes = await envioDe(c.comprobanteId);
    const res = await api(
      ctx,
      A().token.supervisor,
      'post',
      `/facturacion/comprobantes/${c.comprobanteId}/reintento`,
    );
    expect(res.status, res.text).toBe(400);
    expect(await envioDe(c.comprobanteId)).toEqual(antes);
    expect(trabajosDe(c.comprobanteId)).toEqual([]);
    // Con la clave, sí.
    exigirEstado(await reintentar(c.comprobanteId), 202, 'Reintento manual con clave');
  });

  it('un comprobante inexistente (o de otra empresa) responde 404', async () => {
    const res = await reintentar(randomUUID());
    expect(res.status, res.text).toBe(404);
  });
});

describe('criterio 130 · el plazo de SUNAT', () => {
  it('un envío que llega a plazo_hasta sin respuesta final queda DETENIDO y no se reintenta solo; el reintento manual lo reactiva', async () => {
    ctx.pse.reglas.fallarTransmision(1000);
    const c = await nuevoCobro();
    const plazo = finDelDiaLima(await fechaEmisionDe(c.comprobanteId), 3).getTime();
    await procesarCola(ctx, [A().id]);
    expect((await envioDe(c.comprobanteId))!.estado).toBe('PENDIENTE');

    // Pasa el plazo: el barrido lo detiene (y la cola no lo procesa).
    await avanzar(ctx, plazo + 60 * MIN - ctx.reloj.ahora().getTime(), A());
    await ctx.barrido.barrerAhora();
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'DETENIDO',
      en_curso_hasta: null,
    });
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');
    await procesarCola(ctx, [A().id]);
    const llamadas = (await llamadasDe(c.comprobanteId)).length;
    expect((await envioDe(c.comprobanteId))!.estado).toBe('DETENIDO');

    // No se reintenta solo, por mucho que pase el tiempo ni cuántas veces barra o llegue un trabajo.
    await avanzar(ctx, 5 * 60 * MIN, A());
    await ctx.barrido.barrerAhora();
    await ctx.cola.encolar({ empresaId: A().id, comprobanteId: c.comprobanteId });
    await procesarCola(ctx, [A().id]);
    expect(await llamadasDe(c.comprobanteId)).toHaveLength(llamadas);
    expect((await envioDe(c.comprobanteId))!.estado).toBe('DETENIDO');

    // El reintento manual lo reactiva igual, aunque el plazo ya pasó.
    ctx.pse.reglas.limpiar();
    const res = await escribir(
      ctx,
      A().token.supervisor,
      'post',
      `/facturacion/comprobantes/${c.comprobanteId}/reintento`,
    );
    exigirEstado(res, 202, 'Reintento manual de un envío DETENIDO (006, criterios 130 y 132)');
    expect(res.body.estado).toBe('PENDIENTE');
    expect(await envioDe(c.comprobanteId)).toMatchObject({ estado: 'PENDIENTE' });
    await procesarCola(ctx, [A().id]);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await envioDe(c.comprobanteId))!.estado).toBe('TERMINADO');
  });
});
