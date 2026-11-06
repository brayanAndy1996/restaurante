// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · El envío se registra en la misma transacción y se encola después de confirmar (ruta crítica), criterios 124 y 126:
// - toda emisión (cobro, venta de mostrador, nota de crédito y reemisión) inserta en su transacción una fila `envio_pse`
//   (`PENDIENTE`, `intentos` 0, `proximo_intento_en` = `emitido_en`, `plazo_hasta` del criterio 130) y encola el trabajo
//   `envio-pse` con solo `{ empresaId, comprobanteId }`, después de confirmar;
// - un cobro que falla a propósito después de numerar no deja envío, ni trabajo en la cola, ni llamada al PSE;
// - la respuesta del cobro no espera al PSE (con el simulador demorando 5 s, el cobro responde en menos de 1 s);
// - una réplica del cobro no registra otro envío ni encola otro trabajo;
// - si encolar falla después del COMMIT, el cobro responde 201 igual y el barrido encuentra el envío, lo encola y el
//   procesador lo deja aceptado;
// - cada comprobante copia al emitirse `simulado` según el modo de su emisor en ese instante (criterio 122).
// Hoy falla porque `envio_pse` no existe y las rutas de 6b responden «No implementado».
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activarSimulado,
  anularComprobante,
  arrancarFact,
  cerrarAdmin,
  cobrarCrudo,
  cobrarFactura,
  cobrarLomo,
  comprobanteFila,
  contar,
  crearEscenarioFact,
  cuentaCon,
  cuerpoDeCobro,
  envioDe,
  escribir,
  estadoDe,
  exigirEstado,
  exigirPse,
  fallarElTicketDelCobro,
  fechaEmisionDe,
  filas,
  finDelDiaLima,
  limitarBarrido,
  procesar,
  procesarCola,
  seriesDeNotas,
  turnoDe,
  venderMostrador,
  versionDe,
  type AppFact,
  type Escenario,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

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
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
});

const trabajosDe = (comprobanteId: string) =>
  ctx.cola.pendientes().filter((t) => t.comprobanteId === comprobanteId);

/** Lo que exige el criterio 124 de un envío recién registrado de un comprobante emitido en `tipo`. */
async function exigirEnvioRegistrado(comprobanteId: string, diasDePlazo = 3): Promise<void> {
  const c = await comprobanteFila(comprobanteId);
  const envio = await envioDe(comprobanteId);
  expect(envio, `fila envio_pse del comprobante ${comprobanteId}`).toBeDefined();
  expect(envio).toMatchObject({
    empresa_id: c.empresa_id,
    estado: 'PENDIENTE',
    intentos: 0,
    en_curso_hasta: null,
    intento_en_curso: null,
    ultimo_resultado: null,
    ultimo_error: null,
    alertado_en: null,
  });
  expect(new Date(envio!.proximo_intento_en as string).getTime()).toBe(
    new Date(c.emitido_en as string).getTime(),
  );
  expect(new Date(envio!.plazo_hasta as string).getTime()).toBe(
    finDelDiaLima(await fechaEmisionDe(comprobanteId), diasDePlazo).getTime(),
  );
  // Encolado después de confirmar, con solo los dos ids (criterios 124 y 163).
  const trabajos = trabajosDe(comprobanteId);
  expect(trabajos).toHaveLength(1);
  expect(trabajos[0]).toMatchObject({ empresaId: c.empresa_id, comprobanteId });
  expect(Object.keys(trabajos[0]!).filter((k) => k !== 'startAfter')).toHaveLength(2);
  // Nada llamó al PSE (ni dentro de la transacción ni después de confirmar).
  expect(ctx.pse.llamadas()).toEqual([]);
}

describe('criterio 124 · registro del envío en la emisión', () => {
  it('un cobro de boleta deja el envío PENDIENTE, con su plazo de 3 días, y un solo trabajo en la cola', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarLomo(ctx, A(), { turnoId });
    await exigirEnvioRegistrado(comprobanteId);
  });

  it('un cobro de factura hace lo mismo', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const { comprobanteId } = await cobrarFactura(ctx, A(), { turnoId });
    expect((await comprobanteFila(comprobanteId)).tipo).toBe('FACTURA');
    await exigirEnvioRegistrado(comprobanteId);
  });

  it('una venta de mostrador hace lo mismo', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const comprobanteId = await venderMostrador(ctx, A(), turnoId);
    await exigirEnvioRegistrado(comprobanteId);
  });

  it('una nota de crédito hace lo mismo, con el plazo de las notas de crédito de boletas', async () => {
    await seriesDeNotas(ctx, A());
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const original = await cobrarLomo(ctx, A(), { turnoId });
    await procesar(ctx, A().id, original.comprobanteId);
    expect(await estadoDe(original.comprobanteId)).toBe('ACEPTADO');
    ctx.cola.vaciar();
    const res = await anularComprobante(
      ctx,
      A().token.supervisor!,
      original.comprobanteId,
      '28.00',
    );
    exigirEstado(res, 201, 'Anular la boleta con una nota de crédito (006, criterio 144)');
    const notaId = res.body.nota.id as string;
    expect((await comprobanteFila(notaId)).tipo).toBe('NOTA_CREDITO_BOLETA');
    await exigirEnvioRegistrado(notaId);
    // El original no se vuelve a encolar por esto.
    expect(trabajosDe(original.comprobanteId)).toEqual([]);
  });

  it('una reemisión ("Emitir otro") de un rechazado hace lo mismo con el comprobante nuevo', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const rechazado = await cobrarLomo(ctx, A(), { turnoId });
    const numero = (rechazado.respuesta.comprobante as { numero: string }).numero;
    ctx.pse.reglas.rechazarNumero(numero, { codigo: '2800', mensaje: 'Rechazo de prueba' });
    await procesar(ctx, A().id, rechazado.comprobanteId);
    expect(await estadoDe(rechazado.comprobanteId)).toBe('RECHAZADO');
    ctx.cola.vaciar();
    ctx.pse.reiniciar();
    const res = await escribir(
      ctx,
      A().token.supervisor,
      'post',
      `/facturacion/comprobantes/${rechazado.comprobanteId}/reemision`,
      { tipo: 'BOLETA' },
    );
    exigirEstado(res, 201, 'Emitir otro (006, criterio 134)');
    const nuevoId = res.body.comprobante.id as string;
    expect(nuevoId).not.toBe(rechazado.comprobanteId);
    await exigirEnvioRegistrado(nuevoId);
    // El rechazado conserva su envío terminado y no se encola de nuevo.
    expect(await envioDe(rechazado.comprobanteId)).toMatchObject({ estado: 'TERMINADO' });
    expect(trabajosDe(rechazado.comprobanteId)).toEqual([]);
  });

  it('una réplica del cobro (la misma clave y el mismo cuerpo) no registra otro envío ni encola otro trabajo', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '28.00',
    });
    const clave = randomUUID();
    const primera = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo, clave);
    exigirEstado(primera, 201, 'Primer cobro');
    const comprobanteId = primera.body.comprobante.id as string;
    const segunda = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo, clave);
    exigirEstado(segunda, 201, 'Réplica del cobro');
    expect(segunda.body.comprobante.id).toBe(comprobanteId);
    expect(await contar('SELECT 1 FROM envio_pse WHERE comprobante_id = $1', [comprobanteId])).toBe(
      1,
    );
    expect(trabajosDe(comprobanteId)).toHaveLength(1);
    expect(ctx.pse.llamadas()).toEqual([]);
  });

  it('un cobro que falla a propósito después de numerar no deja envío, ni trabajo en la cola, ni llamada al PSE', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const mala = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const idMalo = randomUUID();
    const enviosAntes = await contar('SELECT 1 FROM envio_pse WHERE empresa_id = $1', [A().id]);
    const quitar = await fallarElTicketDelCobro(idMalo);
    try {
      const res = await cobrarCrudo(
        ctx,
        A().token.cajero!,
        mala.ordenId,
        cuerpoDeCobro({
          id: idMalo,
          turnoId,
          version: await versionDe(mala.ordenId),
          total: '28.00',
        }),
      );
      expect(res.status, res.text).toBeGreaterThanOrEqual(500);
    } finally {
      await quitar();
    }
    expect(await contar('SELECT 1 FROM envio_pse WHERE empresa_id = $1', [A().id])).toBe(
      enviosAntes,
    );
    expect(await contar('SELECT 1 FROM comprobante WHERE orden_id = $1', [mala.ordenId])).toBe(0);
    expect(ctx.cola.pendientes()).toEqual([]);
    // Ni siquiera corriendo el worker hay algo que enviar.
    expect(await procesarCola(ctx, [A().id])).toBe(0);
    expect(ctx.pse.llamadas()).toEqual([]);
  });
});

describe('criterio 124 · la respuesta del cobro no espera al PSE', () => {
  it('con el simulador demorando 5 s cada llamada, el cobro responde en menos de 1 s y sin llamarlo', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    // Una primera emisión para que el costo de arranque no cuente.
    await cobrarLomo(ctx, A(), { turnoId });
    ctx.pse.reglas.demorar(5000);
    ctx.cola.vaciar();
    const cuenta = await cuentaCon(ctx, A(), 'S1', [['lomo', 1]]);
    const cuerpo = cuerpoDeCobro({
      turnoId,
      version: await versionDe(cuenta.ordenId),
      total: '28.00',
    });
    const inicio = Date.now();
    const res = await cobrarCrudo(ctx, A().token.cajero!, cuenta.ordenId, cuerpo);
    const duracion = Date.now() - inicio;
    exigirEstado(res, 201, 'Cobro con el simulador lento');
    expect(duracion, `el cobro tardó ${duracion} ms`).toBeLessThan(1000);
    // Pasado el cobro tampoco hay llamadas pendientes ni en curso: nadie procesa el envío mientras tanto.
    expect(ctx.pse.llamadas()).toEqual([]);
    expect(trabajosDe(res.body.comprobante.id as string)).toHaveLength(1);
  });
});

describe('criterios 124 y 126 · si encolar falla, el barrido lo recoge', () => {
  it('con la cola que falla al encolar, el cobro responde 201; el barrido encola el envío y el procesador lo acepta', async () => {
    const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    ctx.cola.fallarProximosEncolados(1);
    const { comprobanteId } = await cobrarLomo(ctx, A(), { turnoId });
    // El envío quedó registrado aunque el encolado falló después del COMMIT.
    expect(await envioDe(comprobanteId)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    expect(trabajosDe(comprobanteId)).toEqual([]);
    expect(await estadoDe(comprobanteId)).toBe('POR_ENVIAR');

    const vuelta = await ctx.barrido.barrerAhora();
    expect(vuelta.reencolados).toBeGreaterThanOrEqual(1);
    const trabajos = trabajosDe(comprobanteId);
    expect(trabajos.length).toBeGreaterThanOrEqual(1);
    expect(trabajos[0]).toMatchObject({ empresaId: A().id, comprobanteId });

    await procesarCola(ctx, [A().id, esc.B.id]);
    expect(await estadoDe(comprobanteId)).toBe('ACEPTADO');
    expect(await envioDe(comprobanteId)).toMatchObject({ estado: 'TERMINADO', intentos: 1 });
  });

  it('el barrido encola los envíos vencidos de todas las empresas con el contexto de cada una', async () => {
    const turnoA = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const turnoB = await turnoDe(ctx, esc.B, 'cajero', 'S1', 'caja1');
    ctx.cola.fallarProximosEncolados(2);
    const deA = await cobrarLomo(ctx, A(), { turnoId: turnoA });
    const deB = await cobrarLomo(ctx, esc.B, { turnoId: turnoB });
    expect(ctx.cola.pendientes()).toEqual([]);
    await ctx.barrido.barrerAhora();
    expect(trabajosDe(deA.comprobanteId)[0]).toMatchObject({ empresaId: A().id });
    expect(trabajosDe(deB.comprobanteId)[0]).toMatchObject({ empresaId: esc.B.id });
  });
});

describe('criterio 122 · `simulado` se copia al emitirse', () => {
  it('con el emisor en SIMULADO el comprobante nace simulado; sin configuración, no', async () => {
    const turnoE1 = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const deE1 = await cobrarLomo(ctx, A(), { turnoId: turnoE1 });
    expect((await comprobanteFila(deE1.comprobanteId)).simulado).toBe(true);

    // E2 (Nuevo RUS, sucursal S2) no tiene configuración de PSE: emite igual y su envío espera.
    const turnoE2 = await turnoDe(ctx, A(), 'supervisorS2', 'S2', 'caja1');
    const deE2 = await cobrarLomo(ctx, A(), {
      turnoId: turnoE2,
      sucursal: 'S2',
      token: A().token.supervisorS2!,
    });
    expect((await comprobanteFila(deE2.comprobanteId)).simulado).toBe(false);
    expect(await envioDe(deE2.comprobanteId)).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    expect(trabajosDe(deE2.comprobanteId)).toHaveLength(1);

    // Pasar E2 a SIMULADO no cambia lo ya emitido; lo nuevo nace simulado.
    await activarSimulado(ctx, esc, A(), A().emisor2!);
    expect((await comprobanteFila(deE2.comprobanteId)).simulado).toBe(false);
    const nuevo = await cobrarLomo(ctx, A(), {
      turnoId: turnoE2,
      sucursal: 'S2',
      token: A().token.supervisorS2!,
    });
    expect((await comprobanteFila(nuevo.comprobanteId)).simulado).toBe(true);
    expect(
      (
        await filas(
          'SELECT count(*)::int AS n FROM comprobante WHERE emisor_id = $1 AND simulado',
          [A().emisor2],
        )
      )[0]!.n,
    ).toBe(1);
  });
});
