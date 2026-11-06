// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 1)
//
// Ataque adversarial a la entrega 6b, ronda 1: cada falla confirmada se convierte en pruebas, a partir de la
// especificación (criterios 125, 126, 130, 132, 133, 135, 144, 147, 165 y 167).
// - F1 (media) · criterios 130 y 132: tras `POST …/reintento` de un envío `DETENIDO` (202 `PENDIENTE`), un barrido que corre
//   antes que el worker no lo vuelve a detener; el siguiente procesamiento hace un intento nuevo y, con el PSE sano, el
//   comprobante queda `ACEPTADO`. Si ese intento manual falla y ya pasó el plazo, vuelve a `DETENIDO` (no se reintenta solo).
// - F7 (media) · criterio 133: con más de 1000 comprobantes ya alertados con un motivo, uno nuevo que entra en alerta sí
//   publica su `facturacion.alerta` y su `pse.alerta`, una vez (demora y plazo vencido); y con 20 o más aceptados cuyo PDF
//   falla siempre, un aceptado más nuevo sin PDF sí recibe el suyo en el barrido (criterio 159).
// - F6 (media) · criterios 165 y 167: una `pdf_clave` que no es `comprobantes/<empresa>/<id>/…` (la de B puesta en A con el rol
//   de la API) no se sirve nunca: `GET …/pdf` responde 409 `PDF_NO_DISPONIBLE` y el enlace no sirve ese archivo.
// - F8 (baja) · criterio 125 paso 3: un `ACEPTADO` que llega cuando el barrido ya detuvo el envío por plazo (y ningún otro
//   worker lo tomó) se aplica: comprobante `ACEPTADO`, envío `TERMINADO`, fila de `intento_pse` y sin alerta pendiente.
// - F2 (baja) · criterios 144 y 147: una `posicion` fuera de 1 a 9999 (o no entera) en una `DEVOLUCION` es 400 con `campos`,
//   nunca 409 `CONFLICTO` ni un registro de error de «montos inconsistentes».
// - F3 (baja) · criterio 135: un `cursor` bien formado en base64url pero con fecha imposible, uuid inválido o JSON roto es 400
//   con `campos.cursor`, nunca 500.
// - F4 (baja) · criterio 132: `POST …/reintento` con cualquier cuerpo no vacío es 400 y no cambia ni encola nada; sin cuerpo o
//   con `{}` sigue en 202.
// - F5 (baja) · criterio 133: un comprobante cuyo motivo de alerta alterna (`SIN_CONFIGURACION` y `DEMORADO`, varias veces)
//   publica una `facturacion.alerta` y un `pse.alerta` por motivo distinto en total (aquí, 2), no una por cada cambio.
//
// Hoy fallan así: F1 el barrido vuelve a dejar `DETENIDO` el envío reactivado y el trabajo del reintento no hace nada; F7 las
// alertas (o el PDF) de los comprobantes nuevos nunca salen porque los 1000 (o 20) más viejos ya tratados ocupan el cupo de
// cada vuelta; F6 sirve el PDF de B (200); F8 descarta el `ACEPTADO` tardío y el envío queda `DETENIDO`; F2 responde 409 con
// posición 10000 y un número enorme; F3 responde 500 con una fecha imposible; F4 responde 202; F5 publica una alerta por cada
// cambio de motivo.
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { urlDeRol } from '../utilidades/bd';
import {
  cuerpoNota,
  emitirAceptado,
  notaCrudo,
  prepararNotas,
  turnoAbiertoDe,
  type AppNotas,
} from './fabrica-notas';
import {
  admin,
  arrancarFact,
  avanzar,
  capturarRegistros,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  escribir,
  esperarError,
  eventosPublicados,
  exigirEstado,
  exigirPse,
  fechaEmisionDe,
  filas,
  finDelDiaLima,
  idPse,
  intentosDe,
  limitarBarrido,
  procesar,
  procesarCola,
  type AppFact,
  type Cobrado,
  type EmpresaCaja,
  type Escenario,
  type Libre,
  type RegistrosCapturados,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const MIN = 60_000;
let ctx: AppFact;
let esc: Escenario;
const A = () => esc.A;
const B = () => esc.B;

beforeAll(async () => {
  ctx = await arrancarFact();
  esc = await crearEscenarioFact(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  // Los relojes solo avanzan: cada prueba abre de nuevo las sesiones por si una anterior movió el tiempo.
  await A().refrescarSesiones();
  await B().refrescarSesiones();
  ctx.pse.reglas.limpiar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

// ------------------------------------------------------------------------------------------------
// Ayudas del archivo
// ------------------------------------------------------------------------------------------------

/** Un cobro de un Lomo en la sucursal S1 (caja 1) de la empresa, sin correr el worker. */
async function nuevoCobro(e: EmpresaCaja): Promise<Cobrado> {
  // El turno abierto de la caja (el de las notas de crédito del F2 es el mismo: solo hay uno por caja y persona).
  const cajaId = (await e.cajas()).S1!.caja1;
  const turnoId = await turnoAbiertoDe(ctx, e.token.cajero!, cajaId);
  return cobrarLomo(ctx, e, { turnoId });
}

/** Una vuelta del barrido limitada a las empresas dadas (así no toca los envíos de otros archivos). */
async function barrer(...empresas: string[]): Promise<void> {
  const restaurar = limitarBarrido(ctx, empresas);
  try {
    await ctx.barrido.barrerAhora();
  } finally {
    restaurar();
  }
}

const reintentar = (id: string, cuerpo?: unknown, token = A().token.supervisor) =>
  escribir(ctx, token, 'post', `/facturacion/comprobantes/${id}/reintento`, cuerpo);

/** Cuántas llamadas al PSE se hicieron sobre ese comprobante (no cuenta las de los demás). */
async function llamadasDe(comprobanteId: string): Promise<number> {
  const id = JSON.stringify(await idPse(comprobanteId));
  return ctx.pse.llamadas().filter((l) => JSON.stringify(l.id) === id).length;
}

interface AlertaRegistrada {
  motivo: string;
  empresaId: string;
  comprobanteId: string;
}

/** Los registros `pse.alerta` de nivel `warn` capturados (criterio 133). */
function alertasRegistradas(reg: RegistrosCapturados): AlertaRegistrada[] {
  return reg.deNivel('warn').flatMap((texto) => {
    try {
      const dato = JSON.parse(texto) as Libre;
      return dato.evento === 'pse.alerta' ? [dato as unknown as AlertaRegistrada] : [];
    } catch {
      return [];
    }
  });
}

const avisosPublicados = (empresaId: string) =>
  eventosPublicados(ctx, 'facturacion.alerta').filter((e) => e.empresaId === empresaId);

/** El cuerpo de una respuesta de error: los nombres de `campos`. */
const nombresDeCampos = (res: { body: Libre }): string[] =>
  ((res.body.campos ?? []) as Array<{ campo: string }>).map((c) => c.campo);

/** Lleva el reloj de la API a `plazo + 60 minutos` del comprobante (el plazo de envío ya venció) y renueva las sesiones. */
async function pasarElPlazo(e: EmpresaCaja, comprobanteId: string): Promise<void> {
  const plazo = finDelDiaLima(await fechaEmisionDe(comprobanteId), 3).getTime();
  await avanzar(ctx, plazo + 60 * MIN - ctx.reloj.ahora().getTime(), e);
}

let siguienteBloque = 0;

interface OpcionesClones {
  cantidad: number;
  estado: 'POR_ENVIAR' | 'ACEPTADO';
  /** Cuánto más viejos que el original (en minutos). */
  minutosMasViejos: number;
}

/**
 * Inserta (como administrador, con un actor fijado) `cantidad` notas de crédito de devolución copiadas de `originalId`:
 * misma empresa, serie y datos, número propio, `emitido_en` anterior al original, el estado dado y sin PDF. Devuelve sus ids.
 */
async function clonarComprobantes(originalId: string, o: OpcionesClones): Promise<string[]> {
  const desde = 100_000 + 10_000 * siguienteBloque++;
  const cliente = await admin();
  const viejo = new Date(ctx.reloj.ahora().getTime() - o.minutosMasViejos * MIN);
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-ataque-6b')");
    const res = await cliente.query(
      `INSERT INTO comprobante
       SELECT (jsonb_populate_record(NULL::comprobante, to_jsonb(c) || jsonb_build_object(
                 'id', gen_random_uuid(), 'cobro_id', NULL, 'tipo', 'NOTA_CREDITO_BOLETA', 'numero', $2::bigint + g,
                 'estado', $3::text, 'emitido_en', $4::text, 'creado_en', $4::text, 'actualizado_en', $4::text,
                 'detalle_parte', NULL, 'orden_id', NULL, 'numero_parte', NULL, 'afecta_a_id', c.id, 'tipo_nota', 'DEVOLUCION', 'motivo_nota', 'x',
                 'pdf_clave', NULL))).*
         FROM comprobante c, generate_series(1, $1::int) g
        WHERE c.id = $5
       RETURNING id`,
      [o.cantidad, desde, o.estado, viejo.toISOString(), originalId],
    );
    await cliente.query('COMMIT');
    return res.rows.map((r) => r.id as string);
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

/** Marca esos comprobantes como ya alertados con `alerta` (cada uno con su envío), como si un barrido anterior los hubiera tratado. */
async function alertarComprobantes(
  ids: string[],
  envio: 'DEMORADO' | 'DETENIDO',
  antes: Date,
): Promise<void> {
  const lejano = new Date(ctx.reloj.ahora().getTime() + 365 * 24 * 60 * MIN);
  const cliente = await admin();
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-ataque-6b')");
    if (envio === 'DEMORADO') {
      await cliente.query(
        `INSERT INTO envio_pse (empresa_id, comprobante_id, estado, intentos, proximo_intento_en, plazo_hasta,
                                alertado_en, alerta, creado_en, actualizado_en)
         SELECT empresa_id, id, 'PENDIENTE', 3, $2, $2, $3, 'DEMORADO', $3, $3
           FROM comprobante WHERE id = ANY($1::uuid[])`,
        [ids, lejano, antes],
      );
    } else {
      await cliente.query(
        `INSERT INTO envio_pse (empresa_id, comprobante_id, estado, intentos, proximo_intento_en, plazo_hasta,
                                alertado_en, alerta, creado_en, actualizado_en)
         SELECT empresa_id, id, 'DETENIDO', 3, NULL, $2, $2, 'DETENIDO', $2, $2
           FROM comprobante WHERE id = ANY($1::uuid[])`,
        [ids, antes],
      );
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------
// F2 · la posición de una línea de devolución (criterios 144 y 147)
// ------------------------------------------------------------------------------------------------

describe('F2 · criterios 144 y 147 · una posición de línea fuera de 1 a 9999 o no entera es 400, no 409', () => {
  let notas: AppNotas;
  let originalId: string;

  beforeAll(async () => {
    await exigirPse(esc);
    notas = {
      ...ctx,
      simulador: ctx.pse,
      almacenComprobantes: ctx.almacenC,
      procesar: (empresaId, comprobanteId) => ctx.procesador.procesar(empresaId, comprobanteId),
    };
    await prepararNotas(notas, esc);
    originalId = (await emitirAceptado(notas, A())).comprobanteId;
  });

  const posiciones: Array<[string, number]> = [
    ['10000 (una más que el máximo)', 10_000],
    ['0', 0],
    ['-1', -1],
    ['1.5', 1.5],
    ['un número enorme', 99_999_999_999],
  ];

  it.each(posiciones)(
    'posicion %s responde 400 con campos, sin registrar un error de montos ni emitir nada',
    async (_nombre, posicion) => {
      const registros = capturarRegistros();
      try {
        const res = await notaCrudo(
          notas,
          A().token.supervisor,
          cuerpoNota({
            comprobanteId: originalId,
            tipo: 'DEVOLUCION',
            total: '28.00',
            lineas: [{ posicion, cantidad: 1 }],
          }),
        );
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.codigo).toBe('DATOS_INVALIDOS');
        expect(nombresDeCampos(res).some((c) => c.includes('posicion'))).toBe(true);
        expect(registros.deNivel('error')).toEqual([]);
      } finally {
        registros.restaurar();
      }
      expect(await filas('SELECT 1 FROM comprobante WHERE afecta_a_id = $1', [originalId])).toEqual(
        [],
      );
    },
  );
});

// ------------------------------------------------------------------------------------------------
// F3 · el cursor del panel (criterio 135)
// ------------------------------------------------------------------------------------------------

describe('F3 · criterio 135 · un cursor mal formado es 400 con campos.cursor, nunca 500', () => {
  const UUID = '00000000-0000-4000-8000-000000000000';
  const codificar = (valor: unknown): string =>
    Buffer.from(typeof valor === 'string' ? valor : JSON.stringify(valor), 'utf8').toString(
      'base64url',
    );

  const casos: Array<[string, string]> = [
    [
      'con una fecha imposible (mes 13, día 45)',
      codificar({ t: '2026-13-45T99:99:99.000000Z', i: UUID }),
    ],
    [
      'con una fecha que no existe en el calendario (30 de febrero)',
      codificar({ t: '2026-02-30T10:00:00.000000Z', i: UUID }),
    ],
    ['con un uuid inválido', codificar({ t: '2026-11-02T10:00:00.000000Z', i: 'no-es-un-uuid' })],
    ['con JSON roto', codificar('{"t": "2026-11-02T10:00:00.000000Z", "i": ')],
  ];

  it.each(casos)('un cursor %s responde 400 con campos.cursor', async (_nombre, cursor) => {
    const res = await ctx
      .http()
      .get(`/facturacion/comprobantes?cursor=${cursor}`)
      .set('Authorization', `Bearer ${A().token.supervisor}`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    expect(nombresDeCampos(res)).toContain('cursor');
  });
});

// ------------------------------------------------------------------------------------------------
// F4 · el reintento manual no acepta cuerpo (criterio 132)
// ------------------------------------------------------------------------------------------------

describe('F4 · criterio 132 · el reintento manual no acepta cuerpo', () => {
  async function envioEsperando(): Promise<Cobrado> {
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro(A());
    await procesarCola(ctx, [A().id]);
    const envio = await envioDe(c.comprobanteId);
    expect(envio).toMatchObject({ estado: 'PENDIENTE', intentos: 1 });
    ctx.cola.vaciar();
    return c;
  }

  const cuerpos: Array<[string, () => unknown]> = [
    ['{ cualquiera: "cosa" }', () => ({ cualquiera: 'cosa' })],
    ['{ empresaId: <id de B> }', () => ({ empresaId: B().id })],
  ];

  it.each(cuerpos)(
    'con el cuerpo %s responde 400, el envío no cambia y no se encola nada',
    async (_nombre, cuerpo) => {
      const c = await envioEsperando();
      const antes = await envioDe(c.comprobanteId);
      const res = await reintentar(c.comprobanteId, cuerpo());
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.codigo).toBe('DATOS_INVALIDOS');
      expect(await envioDe(c.comprobanteId)).toEqual(antes);
      expect(ctx.cola.pendientes()).toEqual([]);
    },
  );

  it('sin cuerpo y con {} sigue respondiendo 202 y adelanta el envío', async () => {
    const c = await envioEsperando();
    exigirEstado(
      await reintentar(c.comprobanteId),
      202,
      'Reintento sin cuerpo (006, criterio 132)',
    );
    ctx.cola.vaciar();
    exigirEstado(
      await reintentar(c.comprobanteId, {}),
      202,
      'Reintento con {} (006, criterio 132)',
    );
    expect(ctx.cola.pendientes().map((t) => t.comprobanteId)).toContain(c.comprobanteId);
  });
});

// ------------------------------------------------------------------------------------------------
// F1 · el reintento manual de un DETENIDO y el barrido que corre antes que el worker (criterios 130 y 132)
// ------------------------------------------------------------------------------------------------

describe('F1 · criterios 130 y 132 · el barrido no desbarata el reintento manual de un envío DETENIDO', () => {
  /** Un envío que agotó su plazo y quedó `DETENIDO`, con el PSE fallando. Devuelve el comprobante. */
  async function envioDetenido(): Promise<Cobrado> {
    ctx.pse.reglas.fallarTransmision(1000);
    const c = await nuevoCobro(A());
    await procesarCola(ctx, [A().id]);
    await pasarElPlazo(A(), c.comprobanteId);
    await barrer(A().id);
    expect((await envioDe(c.comprobanteId))!.estado, 'el envío vencido queda DETENIDO').toBe(
      'DETENIDO',
    );
    return c;
  }

  it('el barrido que corre antes del worker no lo vuelve a detener: el siguiente procesamiento hace un intento nuevo y queda ACEPTADO', async () => {
    const c = await envioDetenido();
    const intentosAntes = (await envioDe(c.comprobanteId))!.intentos as number;
    const filasAntes = (await intentosDe(c.comprobanteId)).length;

    ctx.pse.reglas.limpiar();
    const res = await reintentar(c.comprobanteId);
    exigirEstado(res, 202, 'Reintento manual de un envío DETENIDO (006, criterios 130 y 132)');
    expect(res.body.estado).toBe('PENDIENTE');

    // El barrido (cada minuto) corre antes de que el worker tome el trabajo del reintento.
    await barrer(A().id);
    expect((await envioDe(c.comprobanteId))!.estado, 'el barrido no vuelve a detenerlo').toBe(
      'PENDIENTE',
    );

    await procesarCola(ctx, [A().id]);
    const envio = (await envioDe(c.comprobanteId))!;
    expect(envio.intentos).toBe(intentosAntes + 1);
    expect((await intentosDe(c.comprobanteId)).length).toBeGreaterThan(filasAntes);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(envio).toMatchObject({ estado: 'TERMINADO', ultimo_resultado: 'ACEPTADO' });
  });

  it('si ese intento manual falla y el plazo ya pasó, el envío vuelve a DETENIDO y no se reintenta solo', async () => {
    const c = await envioDetenido();
    const intentosAntes = (await envioDe(c.comprobanteId))!.intentos as number;

    // El PSE sigue fallando: el intento manual no puede tener éxito.
    const res = await reintentar(c.comprobanteId);
    exigirEstado(res, 202, 'Reintento manual de un envío DETENIDO (006, criterios 130 y 132)');
    await barrer(A().id);
    await procesarCola(ctx, [A().id]);
    expect(await envioDe(c.comprobanteId), 'el intento manual se hizo').toMatchObject({
      estado: 'DETENIDO',
      intentos: intentosAntes + 1,
    });
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('POR_ENVIAR');

    // No se reintenta solo, por mucho que pase el tiempo.
    const llamadas = await llamadasDe(c.comprobanteId);
    await avanzar(ctx, 5 * 60 * MIN, A());
    await barrer(A().id);
    await procesarCola(ctx, [A().id]);
    expect(await llamadasDe(c.comprobanteId)).toBe(llamadas);
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'DETENIDO',
      intentos: intentosAntes + 1,
    });
  });
});

// ------------------------------------------------------------------------------------------------
// F5 · una alerta por comprobante y motivo (criterio 133)
// ------------------------------------------------------------------------------------------------

describe('F5 · criterio 133 · la alerta se publica una vez por comprobante y motivo, aunque el motivo alterne', () => {
  it('SIN_CONFIGURACION y DEMORADO alternados cinco veces publican solo dos alertas en total, una por motivo', async () => {
    const registros = capturarRegistros();
    try {
      const c = await nuevoCobro(A());
      const id = c.comprobanteId;
      const paso = async (regla: 'configuracion' | 'transporte', minutos: number) => {
        if (regla === 'configuracion') ctx.pse.reglas.errorDeConfiguracion(1);
        else ctx.pse.reglas.fallarTransmision(1);
        await avanzar(ctx, minutos * MIN, A());
        await procesar(ctx, A().id, id);
        return (await envioDe(id))!.ultimo_resultado as string;
      };
      expect(await paso('configuracion', 0)).toBe('ERROR_CONFIGURACION');
      expect(await paso('transporte', 31)).toBe('ERROR_TRANSPORTE');
      expect(await paso('configuracion', 120)).toBe('ERROR_CONFIGURACION');
      expect(await paso('transporte', 120)).toBe('ERROR_TRANSPORTE');
      expect(await paso('configuracion', 120)).toBe('ERROR_CONFIGURACION');

      const motivos = alertasRegistradas(registros)
        .filter((a) => a.comprobanteId === id)
        .map((a) => a.motivo);
      expect([...motivos].sort()).toEqual(['DEMORADO', 'SIN_CONFIGURACION']);
      // Los avisos en vivo son los mismos: en esta prueba solo este comprobante alerta en la empresa.
      expect(avisosPublicados(A().id)).toHaveLength(2);
    } finally {
      registros.restaurar();
    }
  });
});

// ------------------------------------------------------------------------------------------------
// F8 · el ACEPTADO que llega después de que el barrido detuvo el envío (criterio 125, paso 3)
// ------------------------------------------------------------------------------------------------

describe('F8 · criterio 125 · el resultado final de un worker lento se aplica si nadie más tomó el envío', () => {
  it('un ACEPTADO que llega con el envío ya DETENIDO por plazo (sin otro worker) deja el comprobante ACEPTADO y el envío TERMINADO', async () => {
    const c = await nuevoCobro(A());
    const plazo = finDelDiaLima(await fechaEmisionDe(c.comprobanteId), 3).getTime();
    // Un minuto antes del plazo toca el intento; el PSE tarda en responder.
    await avanzar(ctx, plazo - MIN - ctx.reloj.ahora().getTime(), A());
    ctx.pse.reglas.demorar(1500);
    const enCurso = procesar(ctx, A().id, c.comprobanteId);
    enCurso.catch(() => undefined); // si la prueba falla antes de esperarlo, que no quede sin atender
    let envio: Libre | undefined;
    for (let i = 0; i < 60 && !envio?.en_curso_hasta; i++) {
      await new Promise((r) => setTimeout(r, 50));
      envio = await envioDe(c.comprobanteId);
    }
    expect(envio?.en_curso_hasta, 'el worker tomó el arriendo').toBeTruthy();
    const arriendo = envio!.intento_en_curso;

    // Pasan 3 minutos (el arriendo venció y el plazo también) y corre el barrido; ningún otro worker toma el envío.
    ctx.reloj.avanzar(3 * MIN);
    await barrer(A().id);
    const durante = await envioDe(c.comprobanteId);
    expect([null, arriendo], 'nadie más tomó el envío').toContain(durante!.intento_en_curso);
    await enCurso;
    ctx.pse.reglas.limpiar();
    await A().refrescarSesiones();

    expect(await llamadasDe(c.comprobanteId), 'una sola llamada: no hubo otro worker').toBe(1);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await envioDe(c.comprobanteId)).toMatchObject({
      estado: 'TERMINADO',
      ultimo_resultado: 'ACEPTADO',
      intento_en_curso: null,
      en_curso_hasta: null,
    });
    const intentos = await intentosDe(c.comprobanteId);
    expect(intentos.map((i) => i.resultado)).toEqual(['ACEPTADO']);

    // Sin alerta pendiente: el panel no lo marca.
    const panel = await ctx
      .http()
      .get('/facturacion/comprobantes?alerta=true')
      .set('Authorization', `Bearer ${A().token.supervisor}`);
    exigirEstado(panel, 200, 'GET /facturacion/comprobantes?alerta=true (006, criterio 135)');
    expect((panel.body.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(
      c.comprobanteId,
    );
  });
});

// ------------------------------------------------------------------------------------------------
// F6 · pdf_clave de otra empresa (criterios 165 y 167)
// ------------------------------------------------------------------------------------------------

describe('F6 · criterios 165 y 167 · una pdf_clave que no es de su comprobante no se sirve', () => {
  it('con la pdf_clave de A apuntando al PDF de B, GET …/pdf responde 409 PDF_NO_DISPONIBLE y el enlace no sirve ese archivo', async () => {
    const cA = await nuevoCobro(A());
    await procesar(ctx, A().id, cA.comprobanteId);
    const cB = await nuevoCobro(B());
    await procesar(ctx, B().id, cB.comprobanteId);
    const filaB = await comprobanteFila(cB.comprobanteId);
    const clavePropia = (await comprobanteFila(cA.comprobanteId)).pdf_clave as string;
    expect(filaB.pdf_clave, 'B tiene su PDF').toBeTruthy();
    expect(clavePropia).toContain(`comprobantes/${A().id}/${cA.comprobanteId}/`);
    const bytesDeB = await ctx.almacenC.leer(filaB.pdf_clave as string);
    expect(bytesDeB).not.toBeNull();

    // Con el rol de la API y el contexto de A (tiene UPDATE sobre pdf_clave): la clave de A apunta al PDF de B.
    const rolApi = new Client({ connectionString: urlDeRol('api') });
    await rolApi.connect();
    try {
      await rolApi.query('BEGIN');
      await rolApi.query('SELECT fijar_contexto_empresa($1)', [A().id]);
      await rolApi.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-ataque-6b')");
      const r = await rolApi.query('UPDATE comprobante SET pdf_clave = $2 WHERE id = $1', [
        cA.comprobanteId,
        filaB.pdf_clave,
      ]);
      await rolApi.query('COMMIT');
      expect(r.rowCount, 'se pudo poner la clave ajena').toBe(1);
    } finally {
      await rolApi.end();
    }

    const pdf = await ctx
      .http()
      .get(`/facturacion/comprobantes/${cA.comprobanteId}/pdf`)
      .set('Authorization', `Bearer ${A().token.supervisor}`)
      .buffer(true)
      .parse((resp, listo) => {
        const trozos: Buffer[] = [];
        resp.on('data', (d: Buffer) => trozos.push(d));
        resp.on('end', () => listo(null, Buffer.concat(trozos)));
      });
    expect(pdf.status, 'el PDF de B no sale por la ruta de A').toBe(409);
    expect(JSON.parse((pdf.body as Buffer).toString('utf8')).codigo).toBe('PDF_NO_DISPONIBLE');

    // El enlace tampoco sirve ese archivo: o no hay enlace (como sin PDF) o su dirección pública no entrega los bytes de B.
    const enlace = await ctx
      .http()
      .get(`/facturacion/comprobantes/${cA.comprobanteId}/enlace`)
      .set('Authorization', `Bearer ${A().token.supervisor}`);
    if (enlace.status === 200) {
      const publico = await ctx.http().get(new URL(enlace.body.url as string).pathname);
      expect(publico.status).not.toBe(200);
    } else {
      esperarError(enlace, 409, 'PDF_NO_DISPONIBLE');
    }
  });
});

// ------------------------------------------------------------------------------------------------
// F7 · el cupo de revisión del barrido (criterios 133 y 159)
// ------------------------------------------------------------------------------------------------

describe('F7 · criterios 133 y 159 · los ya tratados no ocupan el cupo del barrido de la empresa', () => {
  it('con 1000 comprobantes ya alertados como DEMORADO, uno nuevo demorado publica su alerta una sola vez', async () => {
    const base = await nuevoCobro(B());
    const antiguos = await clonarComprobantes(base.comprobanteId, {
      cantidad: 1000,
      estado: 'POR_ENVIAR',
      minutosMasViejos: 120,
    });
    await alertarComprobantes(
      antiguos,
      'DEMORADO',
      new Date(ctx.reloj.ahora().getTime() - 60 * MIN),
    );
    const nuevo = await nuevoCobro(B());
    await avanzar(ctx, 31 * MIN, B());

    const registros = capturarRegistros();
    try {
      await barrer(B().id);
      const delNuevo = alertasRegistradas(registros).filter(
        (a) => a.comprobanteId === nuevo.comprobanteId,
      );
      expect(delNuevo.map((a) => a.motivo)).toEqual(['DEMORADO']);
      // Cada alerta registrada tiene su aviso en vivo en la sala de la sucursal.
      const deLaEmpresa = alertasRegistradas(registros).filter((a) => a.empresaId === B().id);
      expect(avisosPublicados(B().id)).toHaveLength(deLaEmpresa.length);
      expect(avisosPublicados(B().id).length).toBeGreaterThan(0);
      // Otra vuelta no la repite.
      await barrer(B().id);
      expect(
        alertasRegistradas(registros).filter((a) => a.comprobanteId === nuevo.comprobanteId),
      ).toHaveLength(1);
    } finally {
      registros.restaurar();
    }
    expect((await envioDe(nuevo.comprobanteId))!.alerta).toBe('DEMORADO');
  });

  it('con 1000 comprobantes ya DETENIDOS y alertados, uno que se detiene por plazo ahora publica su alerta una sola vez', async () => {
    const base = await nuevoCobro(B());
    const antiguos = await clonarComprobantes(base.comprobanteId, {
      cantidad: 1000,
      estado: 'POR_ENVIAR',
      minutosMasViejos: 120,
    });
    await alertarComprobantes(
      antiguos,
      'DETENIDO',
      new Date(ctx.reloj.ahora().getTime() - 60 * MIN),
    );
    ctx.pse.reglas.fallarTransmision(1000);
    const nuevo = await nuevoCobro(B());
    await procesarCola(ctx, [B().id]);
    expect((await envioDe(nuevo.comprobanteId))!.estado).toBe('PENDIENTE');
    await pasarElPlazo(B(), nuevo.comprobanteId);

    const registros = capturarRegistros();
    try {
      await barrer(B().id);
      expect((await envioDe(nuevo.comprobanteId))!.estado).toBe('DETENIDO');
      const delNuevo = alertasRegistradas(registros).filter(
        (a) => a.comprobanteId === nuevo.comprobanteId,
      );
      expect(delNuevo.map((a) => a.motivo)).toEqual(['DETENIDO']);
      const deLaEmpresa = alertasRegistradas(registros).filter((a) => a.empresaId === B().id);
      expect(avisosPublicados(B().id)).toHaveLength(deLaEmpresa.length);
      await barrer(B().id);
      expect(
        alertasRegistradas(registros).filter((a) => a.comprobanteId === nuevo.comprobanteId),
      ).toHaveLength(1);
    } finally {
      registros.restaurar();
    }
    expect((await envioDe(nuevo.comprobanteId))!.alerta).toBe('DETENIDO');
  });

  it('con 21 aceptados cuyo PDF falla siempre, un aceptado más nuevo sin PDF recibe el suyo en el barrido', async () => {
    const base = await nuevoCobro(B());
    await procesar(ctx, B().id, base.comprobanteId);
    expect((await comprobanteFila(base.comprobanteId)).estado).toBe('ACEPTADO');
    const fallan = await clonarComprobantes(base.comprobanteId, {
      cantidad: 21,
      estado: 'ACEPTADO',
      minutosMasViejos: 120,
    });

    // El almacén rechaza todo PDF salvo el de los comprobantes autorizados: los 21 fallan siempre y el nuevo, al principio.
    const permitidos = new Set<string>();
    const guardar = ctx.almacenC.guardar.bind(ctx.almacenC);
    const espia = vi
      .spyOn(ctx.almacenC, 'guardar')
      .mockImplementation(async (clave, contenido, tipo) => {
        if (
          clave.endsWith('representacion.pdf') &&
          ![...permitidos].some((id) => clave.includes(id))
        ) {
          throw new Error('Almacén de pruebas: PDF rechazado');
        }
        await guardar(clave, contenido, tipo);
      });
    try {
      const nuevo = await nuevoCobro(B());
      await procesar(ctx, B().id, nuevo.comprobanteId);
      const sinPdf = await comprobanteFila(nuevo.comprobanteId);
      expect(sinPdf.estado).toBe('ACEPTADO');
      expect(sinPdf.pdf_clave, 'el PDF del nuevo falló al aceptarse').toBeNull();

      // El almacén vuelve a aceptar el PDF del nuevo; los 21 antiguos siguen fallando.
      permitidos.add(nuevo.comprobanteId);
      let pdfClave: unknown = null;
      for (let vuelta = 0; vuelta < 3 && pdfClave === null; vuelta++) {
        await barrer(B().id);
        pdfClave = (await comprobanteFila(nuevo.comprobanteId)).pdf_clave;
      }
      expect(pdfClave, 'el aceptado nuevo recibió su PDF').toBe(
        `comprobantes/${B().id}/${nuevo.comprobanteId}/representacion.pdf`,
      );
      const siguenSinPdf = await filas(
        'SELECT 1 FROM comprobante WHERE id = ANY($1::uuid[]) AND pdf_clave IS NULL',
        [fallan],
      );
      expect(siguenSinPdf, 'los antiguos siguen fallando').toHaveLength(21);
    } finally {
      espia.mockRestore();
    }
  });
});
