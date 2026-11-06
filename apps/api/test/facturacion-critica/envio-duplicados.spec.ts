// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · Sin duplicados ante el PSE (ruta crítica), criterio 128 (RNF-10): el identificador de un documento ante el PSE es
// el mismo en todos los intentos y, desde el segundo, el worker siempre consulta antes de emitir.
// - (a) con «perder la respuesta» una vez, el segundo intento consulta, lo encuentra y lo deja `ACEPTADO` sin otra emisión;
// - (b) con «fallar la transmisión» dos veces, el tercer intento consulta, recibe `NO_EXISTE` y emite: un documento;
// - (c) dos workers a la vez (con el simulador demorando): una sola llamada a `emitir`, un solo intento con resultado, el
//   otro worker termina sin llamar;
// - (d) diez trabajos encolados del mismo comprobante: un documento;
// - (e) un trabajo que llega después de `TERMINADO` no llama al PSE ni deja intento;
// - un arriendo vencido que toma otro worker: el resultado tardío del primero se descarta.
// En todos, `recibidos(id)` nunca pasa de 1.
// Hoy falla porque `envio_pse` no existe y el procesador responde «No implementado».
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  exigirPse,
  envioDe,
  idPse,
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
  ctx.publicador.limpiar();
});

async function nuevoCobro(): Promise<Cobrado> {
  const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
  return cobrarLomo(ctx, A(), { turnoId });
}
const operaciones = () => ctx.pse.llamadas().map((l) => l.operacion);
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('criterio 128 (a) · la respuesta se pierde: el segundo intento consulta y la encuentra', () => {
  it('queda ACEPTADO sin otra emisión: recibidos = 1 y las llamadas son emitir, consultar', async () => {
    ctx.pse.reglas.perderRespuesta(1);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await procesar(ctx, A().id, c.comprobanteId);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 1,
      ultimo_resultado: 'ERROR_TRANSPORTE',
    });
    expect(ctx.pse.recibidos(id)).toBe(1);

    ctx.reloj.avanzar(60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(operaciones()).toEqual(['emitir', 'consultar']);
    expect(ctx.pse.recibidos(id)).toBe(1);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      intentos: 2,
      ultimo_resultado: 'ACEPTADO',
    });
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos.map((i) => [i.operacion, i.resultado])).toEqual([
      ['EMITIR', 'ERROR_TRANSPORTE'],
      ['CONSULTAR', 'ACEPTADO'],
    ]);
  });

  it('el identificador ante el PSE es el mismo en todos los intentos y el documento enviado también', async () => {
    ctx.pse.reglas.perderRespuesta(1);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await procesar(ctx, A().id, c.comprobanteId);
    const primero = JSON.stringify(ctx.pse.documentoRecibido(id));
    ctx.reloj.avanzar(60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas().every((l) => JSON.stringify(l.id) === JSON.stringify(id))).toBe(true);
    expect(JSON.stringify(ctx.pse.documentoRecibido(id))).toBe(primero);
  });
});

describe('criterio 128 (b) · la transmisión falla: el tercer intento consulta, no existe y emite', () => {
  it('con fallarTransmision(2) hay un solo documento al final', async () => {
    ctx.pse.reglas.fallarTransmision(2);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await procesar(ctx, A().id, c.comprobanteId); // intento 1: emitir, falla.
    expect(ctx.pse.recibidos(id)).toBe(0);
    ctx.reloj.avanzar(60_000);
    await procesar(ctx, A().id, c.comprobanteId); // intento 2: consultar, falla.
    expect(ctx.pse.recibidos(id)).toBe(0);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(2);
    ctx.reloj.avanzar(2 * 60_000);
    await procesar(ctx, A().id, c.comprobanteId); // intento 3: consultar (NO_EXISTE) y emitir.
    expect(ctx.pse.recibidos(id)).toBe(1);
    expect(operaciones()).toEqual(['emitir', 'consultar', 'consultar', 'emitir']);
    expect(ctx.pse.llamadas().map((l) => l.resultado)).toEqual([
      'ERROR_TRANSPORTE',
      'ERROR_TRANSPORTE',
      'NO_EXISTE',
      'ACEPTADO',
    ]);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await envioDe(c.comprobanteId)).toMatchObject({ estado: 'TERMINADO', intentos: 3 });
    // Una fila de intento por cada llamada hecha.
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos.map((i) => `${i.operacion}:${i.resultado}`).sort()).toEqual(
      [
        'CONSULTAR:ERROR_TRANSPORTE',
        'CONSULTAR:NO_EXISTE',
        'EMITIR:ACEPTADO',
        'EMITIR:ERROR_TRANSPORTE',
      ].sort(),
    );
  });
});

describe('criterio 128 (c) · dos workers a la vez sobre el mismo envío', () => {
  it('con el simulador demorando 1 s: una sola llamada a emitir, un solo intento con resultado y el otro worker no llama', async () => {
    ctx.pse.reglas.demorar(1000);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await Promise.all([
      procesar(ctx, A().id, c.comprobanteId),
      procesar(ctx, A().id, c.comprobanteId),
    ]);
    expect(operaciones()).toEqual(['emitir']);
    expect(ctx.pse.recibidos(id)).toBe(1);
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({ operacion: 'EMITIR', resultado: 'ACEPTADO' });
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      intentos: 1,
      en_curso_hasta: null,
      intento_en_curso: null,
    });
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
  });

  it('cinco workers a la vez: lo mismo', async () => {
    ctx.pse.reglas.demorar(800);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await Promise.all(Array.from({ length: 5 }, () => procesar(ctx, A().id, c.comprobanteId)));
    expect(operaciones()).toEqual(['emitir']);
    expect(ctx.pse.recibidos(id)).toBe(1);
    expect(await intentosDe(c.comprobanteId)).toHaveLength(1);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
  });
});

describe('criterio 128 (d) · diez trabajos del mismo comprobante', () => {
  it('encolados diez veces y procesados uno tras otro: un documento y un solo intento', async () => {
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    for (let i = 0; i < 9; i++) {
      await ctx.cola.encolar({ empresaId: A().id, comprobanteId: c.comprobanteId });
    }
    expect(ctx.cola.pendientes().filter((t) => t.comprobanteId === c.comprobanteId)).toHaveLength(
      10,
    );
    expect(await procesarCola(ctx, [A().id])).toBe(10);
    expect(operaciones()).toEqual(['emitir']);
    expect(ctx.pse.recibidos(id)).toBe(1);
    expect(await intentosDe(c.comprobanteId)).toHaveLength(1);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
  });

  it('diez trabajos procesados a la vez: lo mismo', async () => {
    ctx.pse.reglas.demorar(300);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await Promise.all(Array.from({ length: 10 }, () => procesar(ctx, A().id, c.comprobanteId)));
    expect(operaciones()).toEqual(['emitir']);
    expect(ctx.pse.recibidos(id)).toBe(1);
    expect(await intentosDe(c.comprobanteId)).toHaveLength(1);
  });
});

describe('criterio 128 (e) · un trabajo que llega después de TERMINADO', () => {
  it('no llama al PSE ni deja intento', async () => {
    const c = await nuevoCobro();
    await procesar(ctx, A().id, c.comprobanteId);
    const llamadas = ctx.pse.llamadas().length;
    const intentos = (await intentosDe(c.comprobanteId)).length;
    ctx.reloj.avanzar(10 * 60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    await ctx.cola.encolar({ empresaId: A().id, comprobanteId: c.comprobanteId });
    await procesarCola(ctx, [A().id]);
    expect(ctx.pse.llamadas()).toHaveLength(llamadas);
    expect(await intentosDe(c.comprobanteId)).toHaveLength(intentos);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
  });
});

describe('criterio 125 y 128 · un arriendo vencido que toma otro worker', () => {
  it('el segundo worker consulta antes de emitir y el resultado tardío del primero se descarta', async () => {
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    // El primer worker se cuelga en `emitir` y al final trae un rechazo que no debe guardarse.
    const espia = vi.spyOn(ctx.pse, 'emitir').mockImplementationOnce(async () => {
      await dormir(1500);
      return { tipo: 'RECHAZADO', origen: 'SUNAT', codigo: '9999', mensaje: 'Resultado tardío' };
    });
    const primero = procesar(ctx, A().id, c.comprobanteId);
    primero.catch(() => undefined); // si la prueba falla antes de esperarlo, que no quede un rechazo sin atender
    let envio: Libre | undefined;
    for (let i = 0; i < 40 && !envio?.en_curso_hasta; i++) {
      await dormir(50);
      envio = await envioDe(c.comprobanteId);
    }
    expect(envio?.en_curso_hasta, 'el primer worker tomó el arriendo').toBeTruthy();
    // Pasan más de 2 minutos: el arriendo venció y otro worker puede tomar el envío.
    ctx.reloj.avanzar(3 * 60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    // El segundo worker (intento 2) consultó primero, recibió NO_EXISTE y emitió.
    expect(operaciones()).toEqual(['consultar', 'emitir']);
    expect(ctx.pse.recibidos(id)).toBe(1);

    await primero;
    espia.mockRestore();
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(fila.rechazado_en).toBeNull();
    expect(fila.sunat_codigo).toBe('0');
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      intentos: 2,
      ultimo_resultado: 'ACEPTADO',
      en_curso_hasta: null,
      intento_en_curso: null,
    });
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos.filter((i) => i.resultado === 'RECHAZADO')).toEqual([]);
    expect(intentos.filter((i) => i.operacion === 'EMITIR')).toHaveLength(1);
    // Un solo cambio de estado publicado.
    const estados = ctx.publicador
      .eventos()
      .filter(
        (e) =>
          e.nombre === 'comprobante.estado' && (e.datos as Libre).comprobanteId === c.comprobanteId,
      )
      .map((e) => (e.datos as Libre).estado);
    expect(estados).toEqual(['ACEPTADO']);
  });
});
