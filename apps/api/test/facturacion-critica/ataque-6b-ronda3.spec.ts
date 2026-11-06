// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 3)
//
// Ataque adversarial a la entrega 6b, ronda 3: cada falla confirmada se convierte en pruebas, a partir de la especificación
// (criterios 125, 145, 153 y 154).
// - C1 (media-alta) · criterios 145, 153 y 154: la réplica por `id` de una nota ya emitida (misma huella: comprobante, tipo,
//   líneas, devolución y cliente; otra clave de idempotencia) responde 201 con la nota ya emitida sin exigir ni consumir una
//   autorización y sin dejar filas de auditoría: sin `X-Autorizacion` es 201; con la autorización de otro objetivo es 201, esa
//   autorización queda sin usar (`usada_en` nulo) y después sirve para su nota legítima. El mismo `id` con otra huella es 422
//   `CLAVE_IDEMPOTENCIA_REUTILIZADA` sin consumir la autorización enviada. Una nota nueva sigue exigiendo y consumiendo la clave.
// - C2 (regresión del lado de la API) · criterio 153: la misma clave de idempotencia con el mismo cuerpo devuelve la misma nota,
//   sin segunda nota ni segundo egreso (la PWA no debe reutilizarla para una devolución distinta: ver
//   `apps/app/test/nota-credito-ataque-r3.spec.tsx`).
// - S1 (baja) · criterio 125: el arriendo del envío cubre el peor caso del paso 2 (dos llamadas al PSE con `PSE_TIMEOUT_MS` más
//   guardar el XML y el CDR, `TIEMPO_LIMITE_R2_MS` cada uno) más margen, y el tiempo que pg-boss da a un trabajo activo antes de
//   darlo por perdido es mayor que el arriendo. Con `PSE_TIMEOUT_MS` = 120000: el reloj manual avanza durante cada llamada y cada
//   archivo, y un segundo worker que entra mientras el primero termina de guardar el CDR no toma el envío; la expiración de la
//   cola (`colas.queue.expire_seconds`) supera el arriendo observado.
//
// Hoy fallan así: C1 la réplica con otra autorización consume esa autorización (o pide una) y deja auditoría; S1 el arriendo de
// 270 s vence a los 280 s del peor caso y un segundo worker llama al PSE, y la cola da por perdido un trabajo a los 300 s, antes
// que un arriendo mayor. Pasan hoy: el 422 por otra huella, la nota nueva con clave y la regresión de la misma IK (C2).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColaPgBoss } from '../../src/nucleo/colas';
import { TIEMPO_LIMITE_R2_MS } from '../../src/nucleo/archivos/almacen-r2';
import { urlDeRol } from '../utilidades/bd';
import {
  autorizarNota,
  contarFilas,
  cuerpoNota,
  emitirAceptado,
  notaCrudo,
  notasDelOriginal,
  objetivoNota,
  prepararNotas,
  turnoAbiertoDe,
  type AppNotas,
} from './fabrica-notas';
import {
  admin,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  esperarError,
  exigirPse,
  filas,
  idPse,
  procesar,
  procesarCola,
  type AppFact,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const TIEMPO_MAXIMO_PSE_MS = 120_000;

let ctx: AppFact;
let notas: AppNotas;
let esc: Escenario;
/** Si el entorno rechazó `PSE_TIMEOUT_MS` = 120000 (un arreglo posible de S1): el mensaje del error. */
let entornoRechazo: string | null = null;
const A = () => esc.A;
const cajero = () => A().token.cajero!;
const supervisor = () => A().token.supervisor!;
const pinSupervisor = () => A().personas.supervisor!.pin;

beforeAll(async () => {
  try {
    ctx = await arrancarFact({ extraEntorno: { PSE_TIMEOUT_MS: String(TIEMPO_MAXIMO_PSE_MS) } });
  } catch (error) {
    entornoRechazo = error instanceof Error ? error.message : String(error);
    if (!entornoRechazo.includes('PSE_TIMEOUT_MS')) throw error;
    ctx = await arrancarFact();
  }
  esc = await crearEscenarioFact(ctx);
  notas = {
    ...ctx,
    simulador: ctx.pse,
    almacenComprobantes: ctx.almacenC,
    procesar: (empresaId, comprobanteId) => ctx.procesador.procesar(empresaId, comprobanteId),
  };
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  await prepararNotas(notas, esc);
  ctx.pse.reglas.limpiar();
  ctx.cola.vaciar();
});

// ------------------------------------------------------------------------------------------------
// C1 · la réplica por id no exige ni consume autorización (criterios 145, 153 y 154)
// ------------------------------------------------------------------------------------------------

const auditoriaDeLaEmpresa = (): Promise<number> =>
  contarFilas('SELECT 1 FROM auditoria WHERE empresa_id = $1', [A().id]);
const usadaEn = async (autorizacionId: string): Promise<unknown> =>
  (await filas('SELECT usada_en FROM autorizacion WHERE id = $1', [autorizacionId]))[0]?.usada_en;

/** Una boleta aceptada y su anulación ya emitida por el Cajero con la clave de un supervisor. */
async function notaYaEmitida() {
  const original = await emitirAceptado(notas, A(), {});
  const total = '69.20';
  const clave = await autorizarNota(
    notas,
    cajero(),
    pinSupervisor(),
    objetivoNota(original.comprobanteId, 'ANULACION', total),
  );
  const cuerpo = cuerpoNota({
    id: randomUUID(),
    comprobanteId: original.comprobanteId,
    tipo: 'ANULACION',
    total,
  });
  const primera = await notaCrudo(notas, cajero(), cuerpo, { autorizacion: clave.autorizacionId });
  expect(primera.status, JSON.stringify(primera.body)).toBe(201);
  return { original, cuerpo, primera, total };
}

describe('C1 · criterios 145, 153 y 154 · la réplica por id de una nota ya emitida no exige ni consume autorización', () => {
  it('sin X-Autorizacion y con otra clave de idempotencia responde 201 con la nota ya emitida, sin auditoría nueva', async () => {
    const { original, cuerpo, primera } = await notaYaEmitida();
    const auditoriaAntes = await auditoriaDeLaEmpresa();

    const replica = await notaCrudo(notas, cajero(), cuerpo);
    expect(replica.status, JSON.stringify(replica.body)).toBe(201);
    expect(replica.body.nota.id).toBe(primera.body.nota.id);
    expect(replica.body.nota.numero).toBe(primera.body.nota.numero);
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(1);
    expect(await auditoriaDeLaEmpresa()).toBe(auditoriaAntes);
  });

  it('con la autorización de OTRO objetivo y otra clave de idempotencia responde 201, deja esa autorización sin usar y sin auditoría', async () => {
    const { cuerpo, primera } = await notaYaEmitida();
    const otro = await emitirAceptado(notas, A(), {});
    const deOtro = await autorizarNota(
      notas,
      cajero(),
      pinSupervisor(),
      objetivoNota(otro.comprobanteId, 'ANULACION', '69.20'),
    );
    const auditoriaAntes = await auditoriaDeLaEmpresa();

    // El mismo `id` y la misma huella, con otro motivo (el motivo no cuenta) y otra clave de idempotencia.
    const replica = await notaCrudo(
      notas,
      cajero(),
      { ...cuerpo, motivo: 'Otro motivo, mismo comprobante' },
      { autorizacion: deOtro.autorizacionId },
    );
    expect(replica.status, JSON.stringify(replica.body)).toBe(201);
    expect(replica.body.nota.id).toBe(primera.body.nota.id);
    expect(
      await usadaEn(deOtro.autorizacionId),
      'la autorización de otro objetivo quedó sin usar',
    ).toBeNull();
    expect(await auditoriaDeLaEmpresa()).toBe(auditoriaAntes);

    // Y esa autorización sirve para su nota legítima.
    const legitima = await notaCrudo(
      notas,
      cajero(),
      cuerpoNota({ comprobanteId: otro.comprobanteId, tipo: 'ANULACION', total: '69.20' }),
      { autorizacion: deOtro.autorizacionId },
    );
    expect(legitima.status, JSON.stringify(legitima.body)).toBe(201);
    expect(await usadaEn(deOtro.autorizacionId)).not.toBeNull();
  });

  it('el mismo id con otra huella responde 422 CLAVE_IDEMPOTENCIA_REUTILIZADA sin consumir la autorización enviada', async () => {
    const { original, cuerpo, primera } = await notaYaEmitida();
    // Otra huella: el mismo comprobante y `id`, pero una devolución de ítems (otro tipo y otras líneas).
    const otraHuella = cuerpoNota({
      id: cuerpo.id as string,
      comprobanteId: original.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: 1, cantidad: 1 }],
      devolucion: null,
    });
    const clave = await autorizarNota(
      notas,
      cajero(),
      pinSupervisor(),
      objetivoNota(original.comprobanteId, 'DEVOLUCION', '28.00'),
    );
    const auditoriaAntes = await auditoriaDeLaEmpresa();

    const res = await notaCrudo(notas, cajero(), otraHuella, {
      autorizacion: clave.autorizacionId,
    });
    esperarError(res, 422, 'CLAVE_IDEMPOTENCIA_REUTILIZADA');
    expect(await usadaEn(clave.autorizacionId), 'la autorización no se consumió').toBeNull();
    expect(await auditoriaDeLaEmpresa()).toBe(auditoriaAntes);
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(1);
    expect(primera.body.nota.id).toBe((await notasDelOriginal(original.comprobanteId))[0]!.id);
  });

  it('una nota nueva del Cajero sigue exigiendo la clave del supervisor y la consume al emitirse', async () => {
    const original = await emitirAceptado(notas, A(), {});
    const cuerpo = cuerpoNota({
      comprobanteId: original.comprobanteId,
      tipo: 'ANULACION',
      total: '69.20',
    });
    const sinClave = await notaCrudo(notas, cajero(), cuerpo);
    esperarError(sinClave, 403, 'CLAVE_REQUERIDA');
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(0);

    const clave = await autorizarNota(
      notas,
      cajero(),
      pinSupervisor(),
      objetivoNota(original.comprobanteId, 'ANULACION', '69.20'),
    );
    const conClave = await notaCrudo(notas, cajero(), cuerpo, {
      autorizacion: clave.autorizacionId,
    });
    expect(conClave.status, JSON.stringify(conClave.body)).toBe(201);
    expect(await usadaEn(clave.autorizacionId)).not.toBeNull();
    expect(await notasDelOriginal(original.comprobanteId)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------
// C2 · del lado de la API: la misma IK con el mismo cuerpo devuelve la misma nota (criterio 153)
// ------------------------------------------------------------------------------------------------

describe('C2 · criterio 153 · la misma clave de idempotencia con el mismo cuerpo devuelve la misma nota', () => {
  it('dos POST iguales con la misma IK dan la misma nota, una sola nota y un solo egreso', async () => {
    const original = await emitirAceptado(notas, A(), {});
    const lomo = (original.cobro.comprobante.lineas as Libre[]).find((l) =>
      /Lomo/.test(l.descripcion as string),
    )!;
    const cuerpo = cuerpoNota({
      comprobanteId: original.comprobanteId,
      tipo: 'DEVOLUCION',
      total: '28.00',
      lineas: [{ posicion: lomo.posicion as number, cantidad: 1 }],
      devolucion: {
        turnoId: original.turnoId,
        pagos: [{ medio: 'EFECTIVO', monto: '28.00' }],
        redondeo: '0.00',
      },
    });
    const ik = randomUUID();
    const primera = await notaCrudo(notas, supervisor(), cuerpo, { ik });
    const segunda = await notaCrudo(notas, supervisor(), cuerpo, { ik });
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201);
    expect(segunda.body.nota.numero).toBe(primera.body.nota.numero);
    const emitidas = await notasDelOriginal(original.comprobanteId);
    expect(emitidas).toHaveLength(1);
    const egresos = await filas('SELECT 1 FROM movimiento_caja WHERE comprobante_id = $1', [
      emitidas[0]!.id,
    ]);
    expect(egresos).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------
// S1 · el arriendo del envío cubre el peor caso del paso 2 y la cola no lo da por perdido antes (criterio 125)
// ------------------------------------------------------------------------------------------------

describe('S1 · criterio 125 · el arriendo del envío cubre dos llamadas lentas al PSE y el guardado del XML y del CDR', () => {
  it('con PSE_TIMEOUT_MS = 120000, otro worker no toma el envío mientras el primero termina de guardar el CDR', async () => {
    if (entornoRechazo !== null) {
      expect(entornoRechazo).toContain('PSE_TIMEOUT_MS');
      return;
    }
    // El intento 1 falla; el 2 consulta (NO_EXISTE), emite, y guarda el XML y el CDR del PSE simulado.
    ctx.pse.reglas.fallarTransmision(1);
    const turnoId = await turnoAbiertoDe(ctx, cajero(), (await A().cajas()).S1!.caja1);
    const c = await cobrarLomo(ctx, A(), { turnoId });
    await procesarCola(ctx, [A().id]);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
    ctx.pse.reglas.limpiar();
    ctx.reloj.avanzar(2 * 60_000);
    const id = await idPse(c.comprobanteId);
    const delDocumento = (l: { id: unknown }) => JSON.stringify(l.id) === JSON.stringify(id);
    const llamadasAntes = ctx.pse.llamadas().filter(delDocumento).length;

    // Cada llamada del primer worker «tarda» el tiempo máximo y cada archivo, el límite de R2, en el reloj de la API (todo es
    // instantáneo de verdad). Al terminar de guardar el CDR (280 s después de tomar el envío) entra un segundo worker.
    let enElSegundo = false;
    let llamadasDelSegundo = 0;
    let arriendoObservadoMs = 0;
    const consultarOriginal = ctx.pse.consultar.bind(ctx.pse);
    const emitirOriginal = ctx.pse.emitir.bind(ctx.pse);
    const guardarOriginal = ctx.almacenC.guardar.bind(ctx.almacenC);
    const espiaConsultar = vi.spyOn(ctx.pse, 'consultar').mockImplementation(async (...args) => {
      if (enElSegundo) {
        llamadasDelSegundo += 1;
        return consultarOriginal(...args);
      }
      const fila = (await envioDe(c.comprobanteId))!;
      arriendoObservadoMs = (fila.en_curso_hasta as Date).getTime() - ctx.reloj.ahora().getTime();
      const respuesta = await consultarOriginal(...args);
      ctx.reloj.avanzar(TIEMPO_MAXIMO_PSE_MS);
      return respuesta;
    });
    const espiaEmitir = vi.spyOn(ctx.pse, 'emitir').mockImplementation(async (...args) => {
      if (enElSegundo) llamadasDelSegundo += 1;
      else ctx.reloj.avanzar(TIEMPO_MAXIMO_PSE_MS);
      return emitirOriginal(...args);
    });
    const espiaGuardar = vi
      .spyOn(ctx.almacenC, 'guardar')
      .mockImplementation(async (clave, contenido, tipo) => {
        const esElCdr = /\/cdr\.(zip|xml)$/.test(clave);
        if (!enElSegundo && (clave.endsWith('/documento.xml') || esElCdr)) {
          ctx.reloj.avanzar(TIEMPO_LIMITE_R2_MS);
        }
        await guardarOriginal(clave, contenido, tipo);
        if (esElCdr && !enElSegundo) {
          enElSegundo = true;
          try {
            await procesar(ctx, A().id, c.comprobanteId);
          } finally {
            enElSegundo = false;
          }
        }
      });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espiaConsultar.mockRestore();
      espiaEmitir.mockRestore();
      espiaGuardar.mockRestore();
    }

    expect(llamadasDelSegundo, 'el segundo worker no llamó al PSE').toBe(0);
    expect(ctx.pse.llamadas().filter(delDocumento).length - llamadasAntes).toBe(2);
    const peorCasoMs = 2 * TIEMPO_MAXIMO_PSE_MS + 2 * TIEMPO_LIMITE_R2_MS;
    expect(
      arriendoObservadoMs,
      'el arriendo supera el peor caso del paso 2 más margen',
    ).toBeGreaterThan(peorCasoMs);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await envioDe(c.comprobanteId)).toMatchObject({ estado: 'TERMINADO', intentos: 2 });
  });

  it('el tiempo que la cola da a un trabajo activo (expire_seconds de envio-pse) es mayor que el arriendo del envío', async () => {
    if (entornoRechazo !== null) {
      expect(entornoRechazo).toContain('PSE_TIMEOUT_MS');
      return;
    }
    // El arriendo, tal como lo deja `tomar` con PSE_TIMEOUT_MS = 120000: se lee del envío en la primera llamada.
    const turnoId = await turnoAbiertoDe(ctx, cajero(), (await A().cajas()).S1!.caja1);
    const c = await cobrarLomo(ctx, A(), { turnoId });
    let arriendoMs = 0;
    const emitirOriginal = ctx.pse.emitir.bind(ctx.pse);
    const espia = vi.spyOn(ctx.pse, 'emitir').mockImplementation(async (...args) => {
      const fila = (await envioDe(c.comprobanteId))!;
      arriendoMs = (fila.en_curso_hasta as Date).getTime() - ctx.reloj.ahora().getTime();
      return emitirOriginal(...args);
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    expect(arriendoMs).toBeGreaterThan(0);

    // La cola real (pg-boss) crea `envio-pse` con su tiempo de expiración.
    const cola = new ColaPgBoss(urlDeRol('colas'));
    try {
      await cola.encolar(
        { empresaId: A().id, comprobanteId: randomUUID() },
        { startAfter: new Date(Date.now() + 3_600_000) },
      );
      const cliente = await admin();
      const cola_ = await cliente.query(
        `SELECT expire_seconds FROM colas.queue WHERE name = 'envio-pse'`,
      );
      const expiraMs = Number(cola_.rows[0]?.expire_seconds) * 1000;
      expect(
        expiraMs,
        'la cola da por perdido un trabajo activo después del arriendo',
      ).toBeGreaterThan(arriendoMs);
    } finally {
      await cola.detener();
    }
  });
});
