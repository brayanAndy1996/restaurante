// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P7 · El worker y los estados del comprobante (ruta crítica), criterios 125, 127 y 131 (lo que se guarda):
// - 125: los tres pasos (tomar con arriendo, llamar sin transacción, guardar), con el procesador llamado a mano;
// - 127: cada fila de la tabla de estados: `ACEPTADO` con XML y CDR guardados en el almacén privado y sus columnas, con
//   observaciones (sigue siendo `ACEPTADO`), `RECHAZADO` de SUNAT y del PSE, `PENDIENTE` → `ENVIADO` → `ACEPTADO` al
//   consultar, y los errores de transporte y de configuración, que no cambian el estado y dejan el siguiente intento;
// - 127: el disparador de la base rechaza (23514) toda transición fuera de la tabla y cambiar una marca de tiempo ya
//   fijada, también desde SQL directo, y deja pasar el `UPDATE` que no cambia el estado;
// - 127 y 172: el evento `comprobante.estado` solo cuando cambia el estado, después de confirmar;
// - 127: los montos, las líneas, la serie y el número no cambian.
// Hoy falla porque `envio_pse`, `intento_pse` y las columnas de 6b no existen y el procesador responde «No implementado».
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import { memorizar } from '../impresion-critica/fabrica-p5';
import { abrirCliente } from '../utilidades';
import {
  api,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  exigirEstado,
  filas,
  idPse,
  intentosDe,
  limitarBarrido,
  procesar,
  turnoDe,
  type AppFact,
  type Cobrado,
  type Escenario,
  type Libre,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let apiSql: Client;
const A = () => esc.A;
let restaurarBarrido: () => void;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
  apiSql = await abrirCliente('api');
  restaurarBarrido = limitarBarrido(ctx, [esc.A.id, esc.B.id]);
});
afterAll(async () => {
  restaurarBarrido?.();
  await ctx?.cerrar();
  await apiSql?.end();
  await cerrarAdmin();
});
beforeEach(() => {
  ctx.pse.reglas.limpiar();
  ctx.pse.reiniciar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

async function nuevoCobro(): Promise<Cobrado> {
  const turnoId = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
  return cobrarLomo(ctx, A(), { turnoId });
}
const numeroDe = (c: Cobrado): string => (c.respuesta.comprobante as { numero: string }).numero;
const trabajosDe = (comprobanteId: string) =>
  ctx.cola.pendientes().filter((t) => t.comprobanteId === comprobanteId);
const eventosDe = (comprobanteId: string) =>
  ctx.publicador
    .eventos()
    .filter(
      (e) =>
        e.nombre === 'comprobante.estado' &&
        (e.datos as { comprobanteId?: string }).comprobanteId === comprobanteId,
    );

async function rechazado(): Promise<Cobrado> {
  const c = await nuevoCobro();
  ctx.pse.reglas.rechazarNumero(numeroDe(c), { codigo: '2800', mensaje: 'Rechazo de prueba' });
  await procesar(ctx, A().id, c.comprobanteId);
  return c;
}

describe('criterio 127 · ACEPTADO', () => {
  it('guarda las columnas de la respuesta, el XML y el CDR en el almacén privado, y deja el envío TERMINADO', async () => {
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas().map((l) => l.operacion)).toEqual(['emitir']);

    const fila = await comprobanteFila(c.comprobanteId);
    const ahora = ctx.reloj.ahora().getTime();
    expect(fila.estado).toBe('ACEPTADO');
    expect(new Date(fila.aceptado_en as string).getTime()).toBe(ahora);
    expect(new Date(fila.enviado_en as string).getTime()).toBe(ahora);
    expect(fila.rechazado_en).toBeNull();
    expect(fila.sunat_codigo).toBe('0');
    expect(String(fila.sunat_mensaje).length).toBeGreaterThan(0);
    expect(fila.sunat_observaciones ?? []).toEqual([]);
    // El hash y la referencia son los que el PSE tiene del documento.
    const consultado = (await ctx.pse.consultar(id, null)) as Libre;
    expect(consultado.tipo).toBe('ACEPTADO');
    expect(fila.hash).toBe(consultado.hash);
    expect(fila.referencia_pse).toBe(consultado.referenciaPse);

    // Archivos en el almacén privado, bajo comprobantes/<empresaId>/<comprobanteId>/…
    const base = `comprobantes/${A().id}/${c.comprobanteId}/`;
    expect(fila.xml_clave).toBe(`${base}documento.xml`);
    expect(fila.cdr_clave).toMatch(new RegExp(`^${base}cdr\\.(zip|xml)$`));
    const xml = ctx.almacenC.obtener(fila.xml_clave as string);
    const cdr = ctx.almacenC.obtener(fila.cdr_clave as string);
    expect(xml?.contenido.toString('latin1')).toContain('SIMULADO');
    expect(cdr?.contenido.toString('latin1')).toContain('SIMULADO');
    expect(xml?.contenido.equals(consultado.xml as Buffer)).toBe(true);
    expect(cdr?.contenido.equals(consultado.cdr as Buffer)).toBe(true);

    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      intentos: 1,
      ultimo_resultado: 'ACEPTADO',
      en_curso_hasta: null,
      intento_en_curso: null,
    });
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({
      numero: 1,
      operacion: 'EMITIR',
      resultado: 'ACEPTADO',
      codigo: '0',
    });
  });

  it('publica comprobante.estado una vez, después de confirmar, en la sala de la sucursal, y no vuelve a encolar', async () => {
    const c = await nuevoCobro();
    await procesar(ctx, A().id, c.comprobanteId);
    const eventos = eventosDe(c.comprobanteId);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      empresaId: A().id,
      sala: { tipo: 'sucursal', sucursalId: A().S1 },
      datos: { comprobanteId: c.comprobanteId, estado: 'ACEPTADO', sucursalId: A().S1 },
    });
    // Solo el trabajo del cobro: un envío terminado no se encola otra vez.
    expect(trabajosDe(c.comprobanteId)).toHaveLength(1);
  });

  it('un ACEPTADO con observaciones es ACEPTADO (no hay un estado "observado") y las observaciones quedan a la vista', async () => {
    const observaciones = [
      { codigo: '4252', mensaje: 'Debe consignar el domicilio fiscal del cliente' },
      { codigo: '4287', mensaje: 'El código del producto SUNAT no es válido' },
    ];
    ctx.pse.reglas.aceptarConObservaciones(observaciones);
    const c = await nuevoCobro();
    await procesar(ctx, A().id, c.comprobanteId);
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(fila.sunat_observaciones).toEqual(observaciones);
    const res = await api(ctx, A().token.supervisor, 'get', `/comprobantes/${c.comprobanteId}`);
    exigirEstado(res, 200, 'Detalle del comprobante (006, criterio 77)');
    expect(res.body.estado).toBe('ACEPTADO');
    expect(res.body.sunat.observaciones).toEqual(observaciones);
    expect(res.body.sunat.codigo).toBe('0');
    expect(res.body.marcas.aceptadoEn).toBe(new Date(ctx.reloj.ahora()).toISOString());
  });
});

describe('criterio 127 · RECHAZADO', () => {
  it('de SUNAT: guarda rechazado_en, el código y el mensaje con el origen; termina el envío; sin archivos ni hash', async () => {
    const c = await rechazado();
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('RECHAZADO');
    expect(new Date(fila.rechazado_en as string).getTime()).toBe(ctx.reloj.ahora().getTime());
    expect(fila.aceptado_en).toBeNull();
    expect(fila.sunat_codigo).toBe('2800');
    expect(fila.sunat_mensaje).toContain('Rechazo de prueba');
    expect(fila.sunat_mensaje).toMatch(/SUNAT/);
    expect(fila.hash).toBeNull();
    expect(fila.xml_clave).toBeNull();
    expect(fila.cdr_clave).toBeNull();
    expect(ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId))).toEqual([]);
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      intentos: 1,
      ultimo_resultado: 'RECHAZADO',
    });
    expect(eventosDe(c.comprobanteId).map((e) => (e.datos as Libre).estado)).toEqual(['RECHAZADO']);
  });

  it('del PSE: el mensaje lleva el origen PSE', async () => {
    const c = await nuevoCobro();
    const espia = vi.spyOn(ctx.pse, 'emitir').mockResolvedValueOnce({
      tipo: 'RECHAZADO',
      origen: 'PSE',
      codigo: 'PSE-01',
      mensaje: 'El RUC no está habilitado en el PSE',
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espia.mockRestore();
    }
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('RECHAZADO');
    expect(fila.sunat_codigo).toBe('PSE-01');
    expect(fila.sunat_mensaje).toContain('El RUC no está habilitado en el PSE');
    expect(fila.sunat_mensaje).toMatch(/PSE/);
    expect(await envioDe(c.comprobanteId)).toMatchObject({ estado: 'TERMINADO' });
  });

  it('un rechazado nunca se vuelve a enviar: otro trabajo suyo no llama al PSE ni deja intentos', async () => {
    const c = await rechazado();
    const llamadas = ctx.pse.llamadas().length;
    ctx.reloj.avanzar(10 * 60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas()).toHaveLength(llamadas);
    expect(await intentosDe(c.comprobanteId)).toHaveLength(1);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('RECHAZADO');
  });
});

describe('criterio 127 · PENDIENTE', () => {
  it('POR_ENVIAR → ENVIADO con su próximo intento; al consultar queda ACEPTADO sin repetir enviado_en', async () => {
    ctx.pse.reglas.responderPendiente(1);
    const c = await nuevoCobro();
    const id = await idPse(c.comprobanteId);
    const t0 = ctx.reloj.ahora().getTime();
    await procesar(ctx, A().id, c.comprobanteId);

    let fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ENVIADO');
    expect(new Date(fila.enviado_en as string).getTime()).toBe(t0);
    expect(fila.aceptado_en).toBeNull();
    expect(fila.referencia_pse).toMatch(/^SIM-/);
    let envio = (await envioDe(c.comprobanteId))!;
    expect(envio).toMatchObject({
      estado: 'ESPERANDO_RESPUESTA',
      intentos: 1,
      ultimo_resultado: 'PENDIENTE',
      en_curso_hasta: null,
      intento_en_curso: null,
    });
    expect(new Date(envio.proximo_intento_en as string).getTime()).toBe(t0 + 60_000);
    // El siguiente encolado, con startAfter en proximo_intento_en.
    const siguiente = trabajosDe(c.comprobanteId).filter((t) => t.startAfter !== null);
    expect(siguiente).toHaveLength(1);
    expect(siguiente[0]!.startAfter!.getTime()).toBe(t0 + 60_000);
    expect(eventosDe(c.comprobanteId).map((e) => (e.datos as Libre).estado)).toEqual(['ENVIADO']);

    // Antes de tocar no se llama; a la hora, consulta (no emite) y acepta.
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas().map((l) => l.operacion)).toEqual(['emitir']);
    ctx.reloj.avanzar(60_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas().map((l) => l.operacion)).toEqual(['emitir', 'consultar']);
    expect(ctx.pse.recibidos(id)).toBe(1);

    fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('ACEPTADO');
    expect(new Date(fila.enviado_en as string).getTime()).toBe(t0);
    expect(new Date(fila.aceptado_en as string).getTime()).toBe(t0 + 60_000);
    expect(fila.xml_clave).toBe(`comprobantes/${A().id}/${c.comprobanteId}/documento.xml`);
    envio = (await envioDe(c.comprobanteId))!;
    expect(envio).toMatchObject({ estado: 'TERMINADO', intentos: 2, ultimo_resultado: 'ACEPTADO' });
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos.map((i) => [i.numero, i.operacion, i.resultado])).toEqual([
      [1, 'EMITIR', 'PENDIENTE'],
      [2, 'CONSULTAR', 'ACEPTADO'],
    ]);
    expect(eventosDe(c.comprobanteId).map((e) => (e.datos as Libre).estado)).toEqual([
      'ENVIADO',
      'ACEPTADO',
    ]);
  });
});

describe('criterio 127 · errores de transporte y de configuración', () => {
  it('ERROR_TRANSPORTE no cambia el estado: el envío vuelve a PENDIENTE con su próximo intento y no hay evento', async () => {
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro();
    const t0 = ctx.reloj.ahora().getTime();
    await procesar(ctx, A().id, c.comprobanteId);
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('POR_ENVIAR');
    expect(fila.enviado_en).toBeNull();
    expect(fila.sunat_codigo).toBeNull();
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 1,
      ultimo_resultado: 'ERROR_TRANSPORTE',
      en_curso_hasta: null,
      intento_en_curso: null,
    });
    expect(String(envio.ultimo_error).length).toBeGreaterThan(0);
    expect(new Date(envio.proximo_intento_en as string).getTime()).toBe(t0 + 60_000);
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({
      numero: 1,
      operacion: 'EMITIR',
      resultado: 'ERROR_TRANSPORTE',
    });
    expect(eventosDe(c.comprobanteId)).toEqual([]);
    const siguiente = trabajosDe(c.comprobanteId).filter((t) => t.startAfter !== null);
    expect(siguiente).toHaveLength(1);
    expect(siguiente[0]!.startAfter!.getTime()).toBe(t0 + 60_000);
  });

  it('ERROR_CONFIGURACION tampoco: se reintenta después y el envío sigue PENDIENTE', async () => {
    ctx.pse.reglas.errorDeConfiguracion(1);
    const c = await nuevoCobro();
    const t0 = ctx.reloj.ahora().getTime();
    await procesar(ctx, A().id, c.comprobanteId);
    const fila = await comprobanteFila(c.comprobanteId);
    expect(fila.estado).toBe('POR_ENVIAR');
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 1,
      ultimo_resultado: 'ERROR_CONFIGURACION',
    });
    expect(new Date(envio.proximo_intento_en as string).getTime()).toBe(t0 + 60_000);
    expect(eventosDe(c.comprobanteId)).toEqual([]);
  });

  it('antes de proximo_intento_en el procesador no llama al PSE ni deja intentos; a la hora, reintenta y acepta', async () => {
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro();
    await procesar(ctx, A().id, c.comprobanteId);
    const llamadas = ctx.pse.llamadas().length;
    await procesar(ctx, A().id, c.comprobanteId);
    ctx.reloj.avanzar(59_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas()).toHaveLength(llamadas);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
    expect(await intentosDe(c.comprobanteId)).toHaveLength(1);

    ctx.reloj.avanzar(1_000);
    await procesar(ctx, A().id, c.comprobanteId);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(2);
  });

  it('un emisor sin configuración de PSE no llama a nadie: ERROR_CONFIGURACION y el comprobante sigue POR_ENVIAR', async () => {
    // E2 (Nuevo RUS, sucursal S2) no tiene configuración.
    const turnoId = await turnoDe(ctx, A(), 'supervisorS2', 'S2', 'caja1');
    const c = await cobrarLomo(ctx, A(), {
      turnoId,
      sucursal: 'S2',
      token: A().token.supervisorS2!,
    });
    await procesar(ctx, A().id, c.comprobanteId);
    expect(ctx.pse.llamadas()).toEqual([]);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'PENDIENTE',
      intentos: 1,
      ultimo_resultado: 'ERROR_CONFIGURACION',
    });
  });
});

describe('criterio 125 · los tres pasos con el arriendo', () => {
  it('mientras llama al PSE el envío tiene su arriendo (2 minutos) y no hay ninguna transacción abierta con la fila', async () => {
    ctx.pse.reglas.demorar(2500);
    const c = await nuevoCobro();
    const t0 = ctx.reloj.ahora().getTime();
    const en_curso = procesar(ctx, A().id, c.comprobanteId);
    // Paso 1 confirmado: el arriendo y el intento ya están a la vista de otra conexión.
    let envio: Libre | undefined;
    for (let i = 0; i < 40 && !envio?.en_curso_hasta; i++) {
      await new Promise((r) => setTimeout(r, 50));
      envio = await envioDe(c.comprobanteId);
    }
    expect(envio, 'el arriendo se confirma antes de llamar al PSE').toBeDefined();
    expect(new Date(envio!.en_curso_hasta as string).getTime()).toBe(t0 + 2 * 60_000);
    expect(envio!.intento_en_curso).toMatch(/^[0-9a-f-]{36}$/);
    expect(envio!.intentos).toBe(1);
    // Paso 2 sin transacción: nadie tiene la fila bloqueada (NOWAIT falla con 55P03 si el worker la retuviera).
    const admin = await abrirCliente('admin');
    try {
      await admin.query('BEGIN');
      await admin.query('SELECT 1 FROM envio_pse WHERE comprobante_id = $1 FOR UPDATE NOWAIT', [
        c.comprobanteId,
      ]);
      await admin.query('SELECT 1 FROM comprobante WHERE id = $1 FOR UPDATE NOWAIT', [
        c.comprobanteId,
      ]);
    } finally {
      await admin.query('ROLLBACK');
      await admin.end();
    }
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');
    await en_curso;
    // Paso 3: guardó el resultado y soltó el arriendo.
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      en_curso_hasta: null,
      intento_en_curso: null,
    });
  });

  it('un trabajo de un comprobante inexistente termina sin hacer nada y sin lanzar', async () => {
    await expect(procesar(ctx, A().id, randomUUID())).resolves.toBeUndefined();
    expect(ctx.pse.llamadas()).toEqual([]);
  });

  it('los montos, las líneas, la serie y el número no cambian al guardar la respuesta', async () => {
    const c = await nuevoCobro();
    const fijas = async () => ({
      comprobante: Object.fromEntries(
        Object.entries(await comprobanteFila(c.comprobanteId)).filter(
          ([k]) =>
            ![
              'estado',
              'enviado_en',
              'aceptado_en',
              'rechazado_en',
              'anulado_en',
              'sunat_codigo',
              'sunat_mensaje',
              'sunat_observaciones',
              'hash',
              'referencia_pse',
              'xml_clave',
              'cdr_clave',
              'pdf_clave',
            ].includes(k) && !k.startsWith('actualizado_'),
        ),
      ),
      lineas: await filas(
        'SELECT * FROM comprobante_linea WHERE comprobante_id = $1 ORDER BY posicion',
        [c.comprobanteId],
      ),
    });
    const antes = await fijas();
    await procesar(ctx, A().id, c.comprobanteId);
    expect(await fijas()).toEqual(antes);
  });
});

describe('criterio 127 · el disparador de transiciones, también desde SQL directo', () => {
  const comoApi = <T>(fn: () => Promise<T>, confirmar = false) =>
    enTransaccion(apiSql, A().id, fn, { confirmar });

  /**
   * Un comprobante en cada estado, llevados ahí por SQL (con transiciones permitidas): esta parte no depende del worker.
   */
  const estados = memorizar(async () => {
    const nuevo = async () => (await nuevoCobro()).comprobanteId;
    const sql = async (id: string, set: string) => {
      await comoApi(async () => {
        await apiSql.query(`UPDATE comprobante SET ${set} WHERE id = $1`, [id]);
      }, true);
    };
    const porEnviar = await nuevo();
    const enviado = await nuevo();
    await sql(enviado, "estado = 'ENVIADO', enviado_en = now()");
    const aceptado = await nuevo();
    await sql(aceptado, "estado = 'ACEPTADO', aceptado_en = now(), enviado_en = now()");
    const rechazadoId = await nuevo();
    await sql(rechazadoId, "estado = 'RECHAZADO', rechazado_en = now()");
    const anulado = await nuevo();
    await sql(anulado, "estado = 'ACEPTADO', aceptado_en = now(), enviado_en = now()");
    await sql(anulado, "estado = 'ANULADO', anulado_en = now()");
    return {
      POR_ENVIAR: porEnviar,
      ENVIADO: enviado,
      ACEPTADO: aceptado,
      RECHAZADO: rechazadoId,
      ANULADO: anulado,
    };
  });

  /** La marca que cada estado exige (para que el único que pueda objetar sea el disparador). */
  const MARCA = {
    POR_ENVIAR: '',
    ENVIADO: ', enviado_en = coalesce(enviado_en, now())',
    ACEPTADO: ', aceptado_en = now(), enviado_en = coalesce(enviado_en, now())',
    RECHAZADO: ', rechazado_en = now()',
    ANULADO: ', anulado_en = now()',
  } as const;
  type E = keyof typeof MARCA;

  const cambiar = async (desde: E, hacia: E) => {
    const ids = await estados();
    return apiSql.query(`UPDATE comprobante SET estado = '${hacia}'${MARCA[hacia]} WHERE id = $1`, [
      ids[desde],
    ]);
  };

  const PERMITIDAS: Array<[E, E]> = [
    ['POR_ENVIAR', 'ENVIADO'],
    ['POR_ENVIAR', 'ACEPTADO'],
    ['POR_ENVIAR', 'RECHAZADO'],
    ['ENVIADO', 'ACEPTADO'],
    ['ENVIADO', 'RECHAZADO'],
    ['ACEPTADO', 'ANULADO'],
  ];
  const INVALIDAS: Array<[E, E]> = [
    ['POR_ENVIAR', 'ANULADO'],
    ['ENVIADO', 'POR_ENVIAR'],
    ['ENVIADO', 'ANULADO'],
    ['ACEPTADO', 'POR_ENVIAR'],
    ['ACEPTADO', 'ENVIADO'],
    ['ACEPTADO', 'RECHAZADO'],
    ['RECHAZADO', 'POR_ENVIAR'],
    ['RECHAZADO', 'ENVIADO'],
    ['RECHAZADO', 'ACEPTADO'],
    ['RECHAZADO', 'ANULADO'],
    ['ANULADO', 'POR_ENVIAR'],
    ['ANULADO', 'ENVIADO'],
    ['ANULADO', 'ACEPTADO'],
    ['ANULADO', 'RECHAZADO'],
  ];

  it('los estados de partida están como se espera', async () => {
    for (const [estado, id] of Object.entries(await estados())) {
      expect((await comprobanteFila(id)).estado, estado).toBe(estado);
    }
  });

  it.each(PERMITIDAS)('deja pasar %s → %s', async (desde, hacia) => {
    await comoApi(async () => {
      await cambiar(desde, hacia);
    });
  });

  it.each(INVALIDAS)('rechaza %s → %s con 23514', async (desde, hacia) => {
    const error = await errorDe(comoApi(() => cambiar(desde, hacia)));
    expect(error.code, error.message).toBe('23514');
  });

  it('un UPDATE que deja el mismo estado no es una transición y pasa, en los cinco estados', async () => {
    for (const id of Object.values(await estados())) {
      await comoApi(async () => {
        await apiSql.query('UPDATE comprobante SET estado = estado WHERE id = $1', [id]);
      });
    }
  });

  it('una marca de tiempo ya fijada no cambia', async () => {
    const casos: Array<[E, string]> = [
      ['ENVIADO', 'enviado_en'],
      ['ACEPTADO', 'aceptado_en'],
      ['ACEPTADO', 'enviado_en'],
      ['RECHAZADO', 'rechazado_en'],
      ['ANULADO', 'anulado_en'],
      ['ANULADO', 'aceptado_en'],
    ];
    const ids = await estados();
    for (const [estado, marca] of casos) {
      const error = await errorDe(
        comoApi(() =>
          apiSql.query(
            `UPDATE comprobante SET ${marca} = ${marca} + interval '1 hour' WHERE id = $1`,
            [ids[estado]],
          ),
        ),
      );
      expect(error.code, `${estado}.${marca}: ${error.message}`).toBe('23514');
    }
  });
});
