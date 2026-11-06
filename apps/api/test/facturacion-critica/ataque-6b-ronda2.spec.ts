// spec: 006-caja-cobro (pruebas protegidas, 6b, ataque ronda 2)
//
// Ataque adversarial a la entrega 6b, ronda 2: cada falla confirmada se convierte en pruebas, a partir de la especificación
// (criterios 125, 159, 165 y 167).
// - H2 (alta) · criterios 165 y 167: una `pdf_clave` que no es exactamente `comprobantes/<empresa>/<comprobante>/representacion.pdf`
//   (por ejemplo, con `..`: `comprobantes/<A>/<cA>/../../<B>/<cB>/representacion.pdf`, que un almacén R2 resuelve a la clave de
//   B) nunca entrega bytes de otro comprobante: `GET …/:id/pdf` responde 409 `PDF_NO_DISPONIBLE`, `…/enlace` responde 409 o un
//   enlace cuya ruta pública da 404, y la ruta pública con el sello de A da 404. Además, el propio `AlmacenComprobantesR2`
//   rechaza (lanza o devuelve nulo) las claves con `..`, segmentos vacíos o fuera del patrón de claves válidas, como el de disco,
//   sin llegar a pedir nada al bucket.
// - H3 (media) · criterio 159: con 200 o más aceptados más viejos cuyo PDF falla siempre, un aceptado nuevo sin PDF recibe el
//   suyo en la siguiente vuelta del barrido (se toleran 2), y los que fallan siguen reintentándose: tras suficientes vueltas, cada
//   uno de una muestra de los viejos (los últimos en el orden del barrido) vuelve a intentarse.
// - S1 (baja) · criterio 125: el arriendo del envío dura más que las dos llamadas al PSE (consultar y emitir) con el
//   `PSE_TIMEOUT_MS` máximo permitido (120 s): con ese valor, un procesamiento cuyas dos llamadas tardan 2 × el tiempo máximo
//   (el reloj manual avanza durante cada llamada) no es tomado por otro worker en medio, así que no hay dos `emitir` del mismo
//   documento. Si el arreglo elige en cambio rechazar en el entorno un `PSE_TIMEOUT_MS` que no cabe en el arriendo, la prueba lo
//   acepta: basta que `crearAplicacion` falle nombrando `PSE_TIMEOUT_MS`.
//
// Hoy fallan así: H2 el PDF de B sale por la ruta de A (200) y por el enlace público; el almacén R2 pide al bucket cualquier
// clave; H3 el aceptado nuevo no recibe PDF en dos vueltas y los últimos de los 220 viejos nunca se vuelven a intentar; S1 un
// segundo worker toma el envío con el arriendo vencido y llama al PSE (consultar y emitir) en medio de la llamada del primero.
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlmacenComprobantesR2 } from '../../src/nucleo/archivos/almacen-comprobantes-r2';
import { urlDeRol } from '../utilidades/bd';
import { turnoAbiertoDe } from './fabrica-notas';
import {
  admin,
  arrancarFact,
  capturarRegistros,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  envioDe,
  esperarError,
  exigirEstado,
  exigirPse,
  filas,
  idPse,
  limitarBarrido,
  procesar,
  procesarCola,
  type AppFact,
  type Cobrado,
  type EmpresaCaja,
  type Escenario,
  type Res,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const MIN = 60_000;
/** El máximo que admite `PSE_TIMEOUT_MS` (criterio 120). */
const TIEMPO_MAXIMO_PSE_MS = 120_000;

let ctx: AppFact;
let esc: Escenario;
/** Si el entorno rechazó `PSE_TIMEOUT_MS` = 120000 (un arreglo posible de S1): el mensaje del error. */
let entornoRechazo: string | null = null;
const A = () => esc.A;
const B = () => esc.B;

beforeAll(async () => {
  try {
    ctx = await arrancarFact({ extraEntorno: { PSE_TIMEOUT_MS: String(TIEMPO_MAXIMO_PSE_MS) } });
  } catch (error) {
    entornoRechazo = error instanceof Error ? error.message : String(error);
    if (!entornoRechazo.includes('PSE_TIMEOUT_MS')) throw error;
    ctx = await arrancarFact();
  }
  esc = await crearEscenarioFact(ctx);
});
afterAll(async () => {
  await ctx?.cerrar();
  await cerrarAdmin();
});
beforeEach(async () => {
  await exigirPse(esc);
  await A().refrescarSesiones();
  await B().refrescarSesiones();
  ctx.pse.reglas.limpiar();
  ctx.cola.vaciar();
  ctx.publicador.limpiar();
});

// ------------------------------------------------------------------------------------------------
// Ayudas del archivo
// ------------------------------------------------------------------------------------------------

/** Un cobro de un Lomo en S1 (caja 1) de la empresa, sin correr el worker. */
async function nuevoCobro(e: EmpresaCaja): Promise<Cobrado> {
  const cajaId = (await e.cajas()).S1!.caja1;
  const turnoId = await turnoAbiertoDe(ctx, e.token.cajero!, cajaId);
  return cobrarLomo(ctx, e, { turnoId });
}

/** Una vuelta del barrido limitada a las empresas dadas. */
async function barrer(...empresas: string[]): Promise<void> {
  const restaurar = limitarBarrido(ctx, empresas);
  try {
    await ctx.barrido.barrerAhora();
  } finally {
    restaurar();
  }
}

/** Pone `pdf_clave` con el rol de la API y el contexto de la empresa (tiene UPDATE sobre esa columna). */
async function ponerPdfClave(
  empresaId: string,
  comprobanteId: string,
  clave: string,
): Promise<void> {
  const rolApi = new Client({ connectionString: urlDeRol('api') });
  await rolApi.connect();
  try {
    await rolApi.query('BEGIN');
    await rolApi.query('SELECT fijar_contexto_empresa($1)', [empresaId]);
    await rolApi.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-ataque-6b-r2')");
    const r = await rolApi.query('UPDATE comprobante SET pdf_clave = $2 WHERE id = $1', [
      comprobanteId,
      clave,
    ]);
    await rolApi.query('COMMIT');
    expect(r.rowCount, 'se pudo poner la clave').toBe(1);
  } finally {
    await rolApi.end();
  }
}

/** Una respuesta como bytes (el cuerpo de un PDF o el de un error JSON). */
const comoBuffer = (resp: Res, listo: (e: Error | null, b: Buffer) => void) => {
  const trozos: Buffer[] = [];
  resp.on('data', (d: Buffer) => trozos.push(d));
  resp.on('end', () => listo(null, Buffer.concat(trozos)));
};

let siguienteBloque = 0;

/**
 * Inserta (como administrador, con un actor fijado) `cantidad` notas de crédito `ACEPTADO` sin PDF copiadas de `originalId`
 * (un comprobante aceptado), `minutosMasViejos` más viejas que él. Devuelve sus ids en el orden del barrido de PDF.
 */
async function clonarAceptados(
  originalId: string,
  cantidad: number,
  minutosMasViejos: number,
): Promise<string[]> {
  const desde = 500_000 + 10_000 * siguienteBloque++;
  const cliente = await admin();
  const viejo = new Date(ctx.reloj.ahora().getTime() - minutosMasViejos * MIN);
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-ataque-6b-r2')");
    const res = await cliente.query(
      `INSERT INTO comprobante
       SELECT (jsonb_populate_record(NULL::comprobante, to_jsonb(c) || jsonb_build_object(
                 'id', gen_random_uuid(), 'cobro_id', NULL, 'tipo', 'NOTA_CREDITO_BOLETA', 'numero', $2::bigint + g,
                 'estado', 'ACEPTADO', 'emitido_en', $3::text, 'creado_en', $3::text, 'actualizado_en', $3::text,
                 'detalle_parte', NULL, 'orden_id', NULL, 'numero_parte', NULL, 'afecta_a_id', c.id,
                 'tipo_nota', 'DEVOLUCION', 'motivo_nota', 'x', 'pdf_clave', NULL))).*
         FROM comprobante c, generate_series(1, $1::int) g
        WHERE c.id = $4
       RETURNING id`,
      [cantidad, desde, viejo.toISOString(), originalId],
    );
    await cliente.query('COMMIT');
    const ids = res.rows.map((r) => r.id as string);
    const orden = await filas(
      'SELECT id FROM comprobante WHERE id = ANY($1::uuid[]) ORDER BY emitido_en, id',
      [ids],
    );
    return orden.map((f) => f.id as string);
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

/** Quita los clones (como administrador) para que no estorben a otras pruebas del archivo. */
async function borrarClones(ids: string[]): Promise<void> {
  const cliente = await admin();
  await cliente.query('BEGIN');
  try {
    await cliente.query("SELECT fijar_contexto_actor(NULL, NULL, NULL, 'prueba-ataque-6b-r2')");
    await cliente.query('DELETE FROM comprobante WHERE id = ANY($1::uuid[])', [ids]);
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------
// H2 · pdf_clave con «..» y el almacén R2 (criterios 165 y 167)
// ------------------------------------------------------------------------------------------------

/**
 * Un `AlmacenComprobantesR2` real sobre un `fetch` falso que hace de bucket: resuelve la URL pedida igual que un servidor
 * (la URL WHATWG quita los `.` y `..` de la ruta) y sirve esa clave del almacén en memoria de la aplicación.
 */
function r2SobreLaMemoria(destino: AppFact['almacenC']) {
  const pedidas: string[] = [];
  const leerOriginal = destino.leer.bind(destino);
  const r2 = new AlmacenComprobantesR2({
    cuentaId: 'cuenta',
    accessKeyId: 'x',
    secretAccessKey: 'y',
    bucket: 'privado',
    fetch: (async (peticion: Request) => {
      const ruta = decodeURIComponent(new URL(peticion.url).pathname).replace(/^\/privado\//, '');
      pedidas.push(ruta);
      const contenido = await leerOriginal(ruta);
      return contenido === null
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array(contenido), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { r2, pedidas };
}

describe('H2 · criterios 165 y 167 · una pdf_clave con «..» no entrega el PDF de otro comprobante', () => {
  async function escenarioDelAtajo() {
    const cA = await nuevoCobro(A());
    await procesar(ctx, A().id, cA.comprobanteId);
    const cB = await nuevoCobro(B());
    await procesar(ctx, B().id, cB.comprobanteId);
    const claveB = (await comprobanteFila(cB.comprobanteId)).pdf_clave as string;
    const bytesDeB = await ctx.almacenC.leer(claveB);
    expect(bytesDeB, 'B tiene su PDF').not.toBeNull();
    const atajo = `comprobantes/${A().id}/${cA.comprobanteId}/../../${B().id}/${cB.comprobanteId}/representacion.pdf`;
    return { cA, cB, claveB, bytesDeB: bytesDeB!, atajo };
  }

  it('GET …/pdf de A con la clave de atajo hacia el PDF de B responde 409 PDF_NO_DISPONIBLE y no pide nada a la carpeta de B', async () => {
    const { cA, bytesDeB, atajo } = await escenarioDelAtajo();
    const { r2, pedidas } = r2SobreLaMemoria(ctx.almacenC);
    const espia = vi.spyOn(ctx.almacenC, 'leer').mockImplementation((clave) => r2.leer(clave));
    try {
      await ponerPdfClave(A().id, cA.comprobanteId, atajo);
      const pdf = await ctx
        .http()
        .get(`/facturacion/comprobantes/${cA.comprobanteId}/pdf`)
        .set('Authorization', `Bearer ${A().token.supervisor}`)
        .buffer(true)
        .parse(comoBuffer);
      const cuerpo = pdf.body as Buffer;
      expect(Buffer.compare(cuerpo, bytesDeB) === 0, 'sirvió los bytes del PDF de B').toBe(false);
      expect(pdf.status, `pedidas al bucket: ${pedidas.join(' | ')}`).toBe(409);
      expect(JSON.parse(cuerpo.toString('utf8')).codigo).toBe('PDF_NO_DISPONIBLE');
      expect(pedidas.filter((p) => p.startsWith(`comprobantes/${B().id}/`))).toEqual([]);
    } finally {
      espia.mockRestore();
    }
  });

  it('el enlace de A con la clave de atajo no sirve el PDF de B, y el sello que A ya tenía tampoco', async () => {
    const { cA, bytesDeB, atajo } = await escenarioDelAtajo();
    const { r2 } = r2SobreLaMemoria(ctx.almacenC);
    // El sello de antes: A pidió su enlace cuando su clave era la suya.
    const antes = await ctx
      .http()
      .get(`/facturacion/comprobantes/${cA.comprobanteId}/enlace`)
      .set('Authorization', `Bearer ${A().token.supervisor}`);
    exigirEstado(antes, 200, 'GET …/enlace con el PDF propio (006, criterio 160)');
    const rutaDelSelloViejo = new URL(antes.body.url as string).pathname;

    const espia = vi.spyOn(ctx.almacenC, 'leer').mockImplementation((clave) => r2.leer(clave));
    try {
      await ponerPdfClave(A().id, cA.comprobanteId, atajo);

      // El sello viejo, ahora que la clave es el atajo: 404, nunca los bytes de B.
      const publicoViejo = await ctx.http().get(rutaDelSelloViejo).buffer(true).parse(comoBuffer);
      expect(Buffer.compare(publicoViejo.body as Buffer, bytesDeB) === 0, 'bytes de B').toBe(false);
      expect(publicoViejo.status).toBe(404);

      // Un enlace nuevo: o no se entrega (409, como sin PDF) o su ruta pública da 404.
      const enlace = await ctx
        .http()
        .get(`/facturacion/comprobantes/${cA.comprobanteId}/enlace`)
        .set('Authorization', `Bearer ${A().token.supervisor}`);
      if (enlace.status === 200) {
        const publico = await ctx
          .http()
          .get(new URL(enlace.body.url as string).pathname)
          .buffer(true)
          .parse(comoBuffer);
        expect(Buffer.compare(publico.body as Buffer, bytesDeB) === 0, 'bytes de B').toBe(false);
        expect(publico.status).toBe(404);
      } else {
        esperarError(enlace, 409, 'PDF_NO_DISPONIBLE');
      }
    } finally {
      espia.mockRestore();
    }
  });
});

describe('H2 · criterio 131 · el almacén R2 rechaza las claves que no son de la forma válida, como el de disco', () => {
  const claveValida = `comprobantes/${'a'.repeat(8)}-1111-4111-8111-${'b'.repeat(12)}/${'c'.repeat(8)}-2222-4222-8222-${'d'.repeat(12)}/representacion.pdf`;
  const clavesInvalidas: Array<[string, string]> = [
    ['con «..» entre carpetas', 'comprobantes/A/cA/../../B/cB/representacion.pdf'],
    ['que sube con «..» al principio', '../comprobantes/B/cB/representacion.pdf'],
    ['con «.» como carpeta', 'comprobantes/A/./cA/representacion.pdf'],
    ['con un segmento vacío', 'comprobantes/A//cA/representacion.pdf'],
    ['que empieza con barra', '/comprobantes/A/cA/representacion.pdf'],
    ['que termina en barra', 'comprobantes/A/cA/'],
    ['con barra invertida', 'comprobantes\\A\\cA\\representacion.pdf'],
    ['con un espacio', 'comprobantes/A/c A/representacion.pdf'],
    ['con parámetros de consulta', 'comprobantes/A/cA/representacion.pdf?versionId=1'],
    ['con un fragmento', 'comprobantes/A/cA/representacion.pdf#x'],
    ['con un porcentaje', 'comprobantes/A/%2e%2e/representacion.pdf'],
    ['vacía', ''],
  ];

  function r2ConBucketEspia() {
    const bucket = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const r2 = new AlmacenComprobantesR2({
      cuentaId: 'cuenta',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      bucket: 'privado',
      fetch: bucket as unknown as typeof fetch,
    });
    return { r2, bucket };
  }

  it.each(clavesInvalidas)(
    'leer una clave %s lanza o devuelve nulo, sin pedir nada al bucket',
    async (_n, clave) => {
      const { r2, bucket } = r2ConBucketEspia();
      let resultado: Buffer | null = null;
      try {
        resultado = await r2.leer(clave);
      } catch {
        resultado = null;
      }
      expect(resultado).toBeNull();
      expect(bucket).not.toHaveBeenCalled();
    },
  );

  it.each(clavesInvalidas)(
    'guardar en una clave %s lanza, sin pedir nada al bucket',
    async (_n, clave) => {
      const { r2, bucket } = r2ConBucketEspia();
      await expect(r2.guardar(clave, Buffer.from('x'), 'application/pdf')).rejects.toThrow();
      expect(bucket).not.toHaveBeenCalled();
    },
  );

  it('la clave de siempre (comprobantes/<empresa>/<comprobante>/representacion.pdf) sí se guarda y se lee', async () => {
    const { r2, bucket } = r2ConBucketEspia();
    await r2.guardar(claveValida, Buffer.from('x'), 'application/pdf');
    expect(await r2.leer(claveValida)).toEqual(Buffer.from([1, 2, 3]));
    expect(bucket).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------------------------------------------
// H3 · el cupo de PDF del barrido con 200 o más que fallan siempre (criterio 159)
// ------------------------------------------------------------------------------------------------

describe('H3 · criterio 159 · los aceptados cuyo PDF falla siempre no dejan sin PDF a los nuevos ni se olvidan para siempre', () => {
  /** Un almacén que rechaza todo PDF salvo el de los comprobantes autorizados. */
  function almacenQueRechazaSalvo(permitidos: Set<string>) {
    const guardar = ctx.almacenC.guardar.bind(ctx.almacenC);
    return vi.spyOn(ctx.almacenC, 'guardar').mockImplementation(async (clave, contenido, tipo) => {
      if (
        clave.endsWith('representacion.pdf') &&
        ![...permitidos].some((id) => clave.includes(id))
      ) {
        throw new Error('Almacén de pruebas: PDF rechazado');
      }
      await guardar(clave, contenido, tipo);
    });
  }

  it('con 220 aceptados viejos que fallan siempre, un aceptado nuevo sin PDF lo recibe en las dos primeras vueltas', async () => {
    const base = await nuevoCobro(B());
    await procesar(ctx, B().id, base.comprobanteId);
    expect((await comprobanteFila(base.comprobanteId)).estado).toBe('ACEPTADO');
    const viejos = await clonarAceptados(base.comprobanteId, 220, 120);
    const permitidos = new Set<string>();
    const espia = almacenQueRechazaSalvo(permitidos);
    try {
      const nuevo = await nuevoCobro(B());
      await procesar(ctx, B().id, nuevo.comprobanteId);
      const sinPdf = await comprobanteFila(nuevo.comprobanteId);
      expect(sinPdf.estado).toBe('ACEPTADO');
      expect(sinPdf.pdf_clave, 'el PDF del nuevo falló al aceptarse').toBeNull();

      permitidos.add(nuevo.comprobanteId);
      let pdfClave: unknown = null;
      let vueltas = 0;
      while (vueltas < 2 && pdfClave === null) {
        await barrer(B().id);
        vueltas += 1;
        pdfClave = (await comprobanteFila(nuevo.comprobanteId)).pdf_clave;
        ctx.reloj.avanzar(MIN);
      }
      expect(pdfClave, `tras ${vueltas} vueltas del barrido el nuevo sigue sin PDF`).toBe(
        `comprobantes/${B().id}/${nuevo.comprobanteId}/representacion.pdf`,
      );
      const siguenSinPdf = await filas(
        'SELECT 1 FROM comprobante WHERE id = ANY($1::uuid[]) AND pdf_clave IS NULL',
        [viejos],
      );
      expect(siguenSinPdf, 'los viejos siguen fallando').toHaveLength(220);
    } finally {
      espia.mockRestore();
      await borrarClones(viejos);
    }
  });

  it('con 220 aceptados que fallan siempre, ninguno queda excluido para siempre: los últimos del orden del barrido también se vuelven a intentar', async () => {
    const base = await nuevoCobro(A());
    await procesar(ctx, A().id, base.comprobanteId);
    const viejos = await clonarAceptados(base.comprobanteId, 220, 120);
    const muestra = viejos.slice(-10); // los últimos que el barrido ofrece: los que hoy nunca llegan
    const espia = almacenQueRechazaSalvo(new Set());
    const registros = capturarRegistros();
    /** Cuántas veces falló el PDF de cada uno de la muestra desde que empezó la prueba (`pdf.no_generado`). */
    const intentosDe = (): Map<string, number> => {
      const cuenta = new Map<string, number>(muestra.map((id) => [id, 0]));
      for (const texto of registros.deNivel('warn')) {
        try {
          const dato = JSON.parse(texto) as { evento?: string; comprobanteId?: string };
          if (dato.evento === 'pdf.no_generado' && cuenta.has(dato.comprobanteId ?? '')) {
            cuenta.set(dato.comprobanteId!, cuenta.get(dato.comprobanteId!)! + 1);
          }
        } catch {
          // no es un registro estructurado
        }
      }
      return cuenta;
    };
    try {
      let vueltas = 0;
      const sinIntentar = () => muestra.filter((id) => intentosDe().get(id) === 0);
      while (vueltas < 14 && sinIntentar().length > 0) {
        await barrer(A().id);
        vueltas += 1;
        ctx.reloj.avanzar(MIN);
      }
      // Control: el barrido sí intentó (y registró) el PDF de los primeros viejos; lo que falta es llegar a los últimos.
      const primeros = viejos.slice(0, 20);
      const registrados = registros
        .deNivel('warn')
        .filter((t) => t.includes('pdf.no_generado') && primeros.some((id) => t.includes(id)));
      expect(
        registrados.length,
        'el barrido registró los fallos de los primeros viejos',
      ).toBeGreaterThan(0);
      expect(
        sinIntentar(),
        `tras ${vueltas} vueltas del barrido hay viejos que nunca se vuelven a intentar`,
      ).toEqual([]);
    } finally {
      registros.restaurar();
      espia.mockRestore();
      await borrarClones(viejos);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// S1 · el arriendo del envío y el tiempo máximo del PSE (criterio 125)
// ------------------------------------------------------------------------------------------------

describe('S1 · criterio 125 · el arriendo del envío dura más que dos llamadas al PSE con su tiempo máximo', () => {
  it('con PSE_TIMEOUT_MS = 120000, otro worker no toma el envío en medio de las dos llamadas (consultar y emitir) del primero', async () => {
    if (entornoRechazo !== null) {
      // Alternativa válida: el entorno rechaza un tiempo máximo cuyo doble no cabe en el arriendo.
      expect(entornoRechazo).toContain('PSE_TIMEOUT_MS');
      return;
    }
    // El intento 1 falla; el 2 consulta (NO_EXISTE) y emite: dos llamadas.
    ctx.pse.reglas.fallarTransmision(1);
    const c = await nuevoCobro(A());
    await procesarCola(ctx, [A().id]);
    expect((await envioDe(c.comprobanteId))!.intentos).toBe(1);
    ctx.pse.reglas.limpiar();
    ctx.reloj.avanzar(2 * MIN);
    const id = await idPse(c.comprobanteId);
    const delDocumento = (l: { id: unknown }) => JSON.stringify(l.id) === JSON.stringify(id);
    const llamadasAntes = ctx.pse.llamadas().filter(delDocumento).length;

    // Cada llamada del primer worker «tarda» el tiempo máximo en el reloj de la API (la llamada real es instantánea). La
    // segunda termina a 2 × el tiempo máximo de haber tomado el envío; justo antes de responder entra un segundo worker.
    let enElSegundo = false;
    let llamadasDelSegundo = 0;
    let emisiones = 0;
    const consultarOriginal = ctx.pse.consultar.bind(ctx.pse);
    const emitirOriginal = ctx.pse.emitir.bind(ctx.pse);
    const espiaConsultar = vi.spyOn(ctx.pse, 'consultar').mockImplementation(async (...args) => {
      if (enElSegundo) llamadasDelSegundo += 1;
      const respuesta = await consultarOriginal(...args);
      if (!enElSegundo) ctx.reloj.avanzar(TIEMPO_MAXIMO_PSE_MS);
      return respuesta;
    });
    const espiaEmitir = vi.spyOn(ctx.pse, 'emitir').mockImplementation(async (...args) => {
      emisiones += 1;
      if (enElSegundo) {
        llamadasDelSegundo += 1;
        return emitirOriginal(...args);
      }
      ctx.reloj.avanzar(TIEMPO_MAXIMO_PSE_MS);
      enElSegundo = true;
      try {
        await procesar(ctx, A().id, c.comprobanteId);
      } finally {
        enElSegundo = false;
      }
      return emitirOriginal(...args);
    });
    try {
      await procesar(ctx, A().id, c.comprobanteId);
    } finally {
      espiaConsultar.mockRestore();
      espiaEmitir.mockRestore();
    }

    expect(llamadasDelSegundo, 'el segundo worker no llamó al PSE').toBe(0);
    expect(emisiones, 'un solo emitir del documento').toBe(1);
    expect(ctx.pse.llamadas().filter(delDocumento).length - llamadasAntes).toBe(2);
    expect((await comprobanteFila(c.comprobanteId)).estado).toBe('ACEPTADO');
    expect(await envioDe(c.comprobanteId)).toMatchObject({ estado: 'TERMINADO', intentos: 2 });
  });
});
