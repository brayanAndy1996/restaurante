// spec: 006-caja-cobro (pruebas protegidas, 6b)
//
// P9 · Archivos privados y enlace público de los comprobantes (ruta crítica), criterios 160 y 165:
// - el XML, el CDR y el PDF viven en el almacén privado bajo `comprobantes/<empresaId>/<comprobanteId>/…` y ninguna ruta los
//   sirve por una URL directa; `GET /facturacion/comprobantes/:id/pdf` con un id de B responde 404 desde A, con el mismo
//   cuerpo que un id inexistente, y 409 `PDF_NO_DISPONIBLE` mientras el comprobante no esté aceptado;
// - `GET /facturacion/comprobantes/:id/enlace` da `{ url, expiraEn }` con `url` = `<API_URL_PUBLICA>/publico/comprobantes/<sello>`
//   y vencimiento a 30 días; el sello (AES-256-GCM, base64url) no deja ver los ids ni se puede adivinar, alterar o fabricar;
// - `GET /publico/comprobantes/:sello` (sin sesión) responde el PDF con `Cache-Control: private, max-age=300`; un sello
//   alterado, de otra clave, vencido (con `RelojManual`), de un comprobante inexistente, sin PDF o con el `comprobanteId`
//   cambiado responde 404 con el mismo cuerpo; el sello de un comprobante de B solo abre el PDF de B; `GET
//   /publico/comprobantes/` no lista nada.
// La ruta pública hoy NO está registrada: cada prueba de un 404 exige primero que un sello válido responda 200 con el PDF,
// para no pasar en vacío con el 404 de la ruta que no existe.
// Hoy falla por «No implementado» (el procesador, el sello y las rutas) y por tablas y columnas que no existen.
import { enlaceComprobanteRespuestaSchema } from '@restaurante/contratos';
import { DIAS_ENLACE_COMPROBANTE } from '@restaurante/dominio';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entorno } from '../../src/config/entorno';
import { EnlacesComprobante } from '../../src/modulos/facturacion';
import { Cifrado } from '../../src/nucleo/cifrado';
import { RelojManual } from '../../src/nucleo/reloj';
import {
  anularComprobante,
  api,
  arrancarFact,
  cerrarAdmin,
  cobrarLomo,
  comprobanteFila,
  crearEscenarioFact,
  exigirEstado,
  exigirPse,
  limitarBarrido,
  procesar,
  seriesDeNotas,
  turnoDe,
  type AppFact,
  type Cobrado,
  type Escenario,
} from './fabrica-facturacion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let restaurarBarrido: () => void;
const A = () => esc.A;
const B = () => esc.B;
const DIA = 24 * 60 * 60_000;

let aceptadoA: Cobrado;
let aceptadoB: Cobrado;
let porEnviarA: Cobrado;

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
});

/** Un comprobante aceptado en A, otro en B y uno por enviar en A (se arman una sola vez). */
let armado: Promise<void> | undefined;
function armar(): Promise<void> {
  armado ??= (async () => {
    const turnoA = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const turnoB = await turnoDe(ctx, B(), 'cajero', 'S1', 'caja1');
    aceptadoA = await cobrarLomo(ctx, A(), { turnoId: turnoA });
    aceptadoB = await cobrarLomo(ctx, B(), { turnoId: turnoB });
    porEnviarA = await cobrarLomo(ctx, A(), { turnoId: turnoA });
    await procesar(ctx, A().id, aceptadoA.comprobanteId);
    await procesar(ctx, B().id, aceptadoB.comprobanteId);
  })();
  return armado;
}

interface Descarga {
  status: number;
  headers: Response['headers'];
  cuerpo: Buffer;
  texto: string;
}

/** Una descarga binaria (el PDF) o JSON (un error), con o sin sesión. */
async function descargar(token: string | undefined, ruta: string): Promise<Descarga> {
  let peticion = ctx
    .http()
    .get(ruta)
    .buffer(true)
    .parse((res, devolver) => {
      const trozos: Buffer[] = [];
      res.on('data', (t: Buffer) => trozos.push(t));
      res.on('end', () => devolver(null, Buffer.concat(trozos)));
    });
  if (token !== undefined) peticion = peticion.set('Authorization', `Bearer ${token}`);
  const res = await peticion;
  const cuerpo = res.body as Buffer;
  return { status: res.status, headers: res.headers, cuerpo, texto: cuerpo.toString('latin1') };
}

const rutaPublica = (sello: string) => `/publico/comprobantes/${sello}`;
const selloDe = (url: string) => url.slice(url.lastIndexOf('/') + 1);

async function enlaceDe(c: Cobrado, e = A()) {
  const res = await api(
    ctx,
    e.token.supervisor,
    'get',
    `/facturacion/comprobantes/${c.comprobanteId}/enlace`,
  );
  exigirEstado(res, 200, 'GET /facturacion/comprobantes/:id/enlace (006, criterio 160)');
  const cuerpo = enlaceComprobanteRespuestaSchema.parse(res.body);
  return { ...cuerpo, sello: selloDe(cuerpo.url) };
}

/** El PDF guardado en el almacén privado para un comprobante. */
async function pdfGuardado(c: Cobrado, empresaId: string): Promise<Buffer> {
  const fila = await comprobanteFila(c.comprobanteId);
  expect(fila.pdf_clave).toBe(`comprobantes/${empresaId}/${c.comprobanteId}/representacion.pdf`);
  const guardado = ctx.almacenC.obtener(fila.pdf_clave as string);
  expect(guardado, 'el PDF está en el almacén privado').toBeDefined();
  return guardado!.contenido;
}

describe('criterio 159 y 165 · el PDF y los archivos viven en el almacén privado de su empresa', () => {
  it('al aceptarse, el XML, el CDR y el PDF quedan bajo comprobantes/<empresaId>/<comprobanteId>/ y no en el almacén de las fotos', async () => {
    await armar();
    for (const [c, empresaId] of [
      [aceptadoA, A().id],
      [aceptadoB, B().id],
    ] as const) {
      const base = `comprobantes/${empresaId}/${c.comprobanteId}/`;
      const claves = ctx.almacenC.claves().filter((k) => k.includes(c.comprobanteId));
      expect(claves.length).toBeGreaterThanOrEqual(3);
      expect(claves.every((k) => k.startsWith(base))).toBe(true);
      expect(claves.some((k) => k.endsWith('documento.xml'))).toBe(true);
      expect(claves.some((k) => /\/cdr\.(zip|xml)$/.test(k))).toBe(true);
      expect(claves).toContain(`${base}representacion.pdf`);
      expect((await pdfGuardado(c, empresaId)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
    expect(ctx.almacen.claves().filter((k) => k.includes('comprobantes'))).toEqual([]);
  });

  it('ninguna ruta sirve los archivos por una URL directa', async () => {
    await armar();
    const fila = await comprobanteFila(aceptadoA.comprobanteId);
    const clave = fila.xml_clave as string;
    const id = aceptadoA.comprobanteId;
    const rutas = [
      `/archivos/${clave}`,
      `/archivos/comprobantes/${A().id}/${id}/documento.xml`,
      `/${clave}`,
      `/comprobantes/${A().id}/${id}/documento.xml`,
      `/facturacion/comprobantes/${id}/xml`,
      `/facturacion/comprobantes/${id}/cdr`,
      `/facturacion/comprobantes/${id}/documento.xml`,
      `/facturacion/comprobantes/${id}/representacion.pdf`,
      `/publico/comprobantes/${A().id}/${id}/documento.xml`,
    ];
    for (const ruta of rutas) {
      for (const token of [A().token.supervisor, undefined]) {
        const res = await descargar(token, ruta);
        expect([401, 404], `${ruta} ${token ? 'con' : 'sin'} sesión: ${res.texto}`).toContain(
          res.status,
        );
        expect(res.texto).not.toContain('SIMULADO');
        expect(res.texto.startsWith('%PDF')).toBe(false);
      }
    }
  });
});

describe('criterio 159 · GET /facturacion/comprobantes/:id/pdf', () => {
  it('un comprobante aceptado responde application/pdf inline con el nombre del número y el PDF guardado', async () => {
    await armar();
    const res = await descargar(
      A().token.supervisor,
      `/facturacion/comprobantes/${aceptadoA.comprobanteId}/pdf`,
    );
    expect(res.status, res.texto.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    const numero = (aceptadoA.respuesta.comprobante as { numero: string }).numero;
    expect(res.headers['content-disposition']).toBe(`inline; filename="${numero}.pdf"`);
    expect(res.cuerpo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.cuerpo.equals(await pdfGuardado(aceptadoA, A().id))).toBe(true);
    const detalle = await api(
      ctx,
      A().token.supervisor,
      'get',
      `/facturacion/comprobantes/${aceptadoA.comprobanteId}`,
    );
    expect(detalle.body.pdfDisponible).toBe(true);
  });

  it('mientras no esté aceptado responde 409 PDF_NO_DISPONIBLE, también el enlace', async () => {
    await armar();
    for (const ruta of ['pdf', 'enlace']) {
      const res = await api(
        ctx,
        A().token.supervisor,
        'get',
        `/facturacion/comprobantes/${porEnviarA.comprobanteId}/${ruta}`,
      );
      expect(res.status, `${ruta}: ${res.text}`).toBe(409);
      expect(res.body.codigo).toBe('PDF_NO_DISPONIBLE');
    }
    expect((await comprobanteFila(porEnviarA.comprobanteId)).pdf_clave).toBeNull();
  });

  it('con un id de B desde A responde 404 con el mismo cuerpo que un id inexistente', async () => {
    await armar();
    for (const ruta of ['pdf', 'enlace']) {
      const deB = await descargar(
        A().token.supervisor,
        `/facturacion/comprobantes/${aceptadoB.comprobanteId}/${ruta}`,
      );
      const inexistente = await descargar(
        A().token.supervisor,
        `/facturacion/comprobantes/${randomUUID()}/${ruta}`,
      );
      expect(deB.status, `${ruta}: ${deB.texto}`).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(deB.texto).toBe(inexistente.texto);
      expect(deB.texto).not.toContain('%PDF');
    }
  });

  it('sin sesión no responde nada (401)', async () => {
    await armar();
    const res = await descargar(
      undefined,
      `/facturacion/comprobantes/${aceptadoA.comprobanteId}/pdf`,
    );
    expect(res.status).toBe(401);
  });

  it('el PDF de un comprobante anulado es el que se guardó al aceptarse', async () => {
    await armar();
    await seriesDeNotas(ctx, A());
    const turnoA = await turnoDe(ctx, A(), 'cajero', 'S1', 'caja1');
    const original = await cobrarLomo(ctx, A(), { turnoId: turnoA });
    await procesar(ctx, A().id, original.comprobanteId);
    const antes = await pdfGuardado(original, A().id);
    const nota = await anularComprobante(
      ctx,
      A().token.supervisor!,
      original.comprobanteId,
      '28.00',
    );
    exigirEstado(nota, 201, 'Anular con una nota de crédito (006, criterio 143)');
    await procesar(ctx, A().id, nota.body.nota.id as string);
    expect((await comprobanteFila(original.comprobanteId)).estado).toBe('ANULADO');
    const res = await descargar(
      A().token.supervisor,
      `/facturacion/comprobantes/${original.comprobanteId}/pdf`,
    );
    expect(res.status, res.texto.slice(0, 200)).toBe(200);
    expect(res.cuerpo.equals(antes)).toBe(true);
  });
});

describe('criterio 160 · el sello del enlace', () => {
  it('el enlace es <API_URL_PUBLICA>/publico/comprobantes/<sello>, vence a los 30 días y el sello no deja ver los ids', async () => {
    await armar();
    const enlace = await enlaceDe(aceptadoA);
    expect(enlace.url.startsWith(`${ctx.url}/publico/comprobantes/`)).toBe(true);
    expect(enlace.expiraEn).toBe(
      new Date(ctx.reloj.ahora().getTime() + DIAS_ENLACE_COMPROBANTE * DIA).toISOString(),
    );
    expect(enlace.sello).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const bytes = Buffer.from(enlace.sello, 'base64url');
    for (const id of [A().id, aceptadoA.comprobanteId]) {
      expect(enlace.sello.toLowerCase()).not.toContain(id.toLowerCase());
      expect(enlace.url.toLowerCase()).not.toContain(id.toLowerCase());
      expect(bytes.includes(Buffer.from(id))).toBe(false);
      expect(bytes.includes(Buffer.from(id.replace(/-/g, ''), 'hex'))).toBe(false);
      expect(bytes.includes(Buffer.from(id.replace(/-/g, '')))).toBe(false);
    }
    // No se puede adivinar: otro enlace del mismo comprobante es otro sello.
    expect((await enlaceDe(aceptadoA)).sello).not.toBe(enlace.sello);
  });

  it('un sello válido abre el PDF sin sesión, con Cache-Control privado de 5 minutos', async () => {
    await armar();
    const { sello } = await enlaceDe(aceptadoA);
    const res = await descargar(undefined, rutaPublica(sello));
    expect(res.status, res.texto.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.cuerpo.equals(await pdfGuardado(aceptadoA, A().id))).toBe(true);
  });

  it('un sello de un comprobante de B solo abre el PDF de B', async () => {
    await armar();
    const { sello } = await enlaceDe(aceptadoB, B());
    const res = await descargar(undefined, rutaPublica(sello));
    expect(res.status, res.texto.slice(0, 200)).toBe(200);
    const deB = await pdfGuardado(aceptadoB, B().id);
    const deA = await pdfGuardado(aceptadoA, A().id);
    expect(res.cuerpo.equals(deB)).toBe(true);
    expect(res.cuerpo.equals(deA)).toBe(false);
  });

  it('GET /publico/comprobantes/ no lista nada (404), con o sin barra final', async () => {
    await armar();
    // Con la ruta registrada un sello válido responde 200: así el 404 de abajo no es el de una ruta ausente.
    const { sello } = await enlaceDe(aceptadoA);
    expect((await descargar(undefined, rutaPublica(sello))).status).toBe(200);
    for (const ruta of ['/publico/comprobantes/', '/publico/comprobantes']) {
      for (const token of [undefined, A().token.supervisor]) {
        const res = await descargar(token, ruta);
        expect(res.status, ruta).toBe(404);
        expect(res.texto).not.toContain('%PDF');
      }
    }
  });

  describe('un sello alterado, fabricado, vencido o de otro comprobante responde 404 con el mismo cuerpo', () => {
    /** Exige que el sello bueno responda 200 y devuelve el cuerpo de cada sello malo para compararlos. */
    async function cuerposDe(malos: Record<string, string>) {
      await armar();
      const bueno = await enlaceDe(aceptadoA);
      const ok = await descargar(undefined, rutaPublica(bueno.sello));
      expect(ok.status, 'un sello válido abre el PDF').toBe(200);
      const resultados: Record<string, Descarga> = {};
      for (const [nombre, sello] of Object.entries(malos)) {
        resultados[nombre] = await descargar(undefined, rutaPublica(sello));
        expect(resultados[nombre]!.status, `${nombre}: ${resultados[nombre]!.texto}`).toBe(404);
        expect(resultados[nombre]!.texto).not.toContain('%PDF');
      }
      return { bueno: bueno.sello, resultados };
    }
    function iguales(resultados: Record<string, Descarga>) {
      const todos = Object.values(resultados);
      for (const r of todos) expect(r.texto).toBe(todos[0]!.texto);
    }
    const cambiar = (sello: string, i: number) =>
      `${sello.slice(0, i)}${sello[i] === 'A' ? 'B' : 'A'}${sello.slice(i + 1)}`;

    it('con un carácter cambiado (al principio, en medio), truncado, alargado o con basura', async () => {
      await armar();
      const { sello } = await enlaceDe(aceptadoA);
      const { resultados } = await cuerposDe({
        'primer carácter': cambiar(sello, 0),
        'carácter 7': cambiar(sello, 7),
        'carácter del medio': cambiar(sello, Math.floor(sello.length / 2)),
        'sin los últimos 4': sello.slice(0, -4),
        'con un carácter de más': `${sello}A`,
        'solo caracteres inválidos': '%%%%%%%%',
        'vacío de datos': 'AAAA',
        larguísimo: 'A'.repeat(5000),
      });
      iguales(resultados);
    });

    it('fabricado con otra clave de cifrado (o con la propia pero para otro propósito)', async () => {
      await armar();
      const otroCifrado = new Cifrado({
        CLAVE_CIFRADO: Buffer.alloc(32, 7).toString('base64'),
      } as unknown as Entorno);
      const deOtraClave = new EnlacesComprobante(otroCifrado, ctx.reloj).sellar({
        empresaId: A().id,
        comprobanteId: aceptadoA.comprobanteId,
        expiraEn: new Date(ctx.reloj.ahora().getTime() + 5 * DIA),
      });
      const propio = ctx.app.get(Cifrado, { strict: false });
      const deOtroProposito = propio
        .sellar(
          JSON.stringify({ v: 1, empresaId: A().id, comprobanteId: aceptadoA.comprobanteId }),
          {
            proposito: 'credencial-pse',
            datosAsociados: `credencial-pse:${A().id}:${A().emisor1}`,
          },
        )
        .toString('base64url');
      const { resultados } = await cuerposDe({
        'otra clave': deOtraClave,
        'otro propósito': deOtroProposito,
      });
      iguales(resultados);
    });

    it('con el comprobanteId cambiado por el de B, vencido, de un comprobante inexistente o sin PDF', async () => {
      await armar();
      const vigente = new Date(ctx.reloj.ahora().getTime() + 5 * DIA);
      const sellar = (empresaId: string, comprobanteId: string, expiraEn: Date) =>
        ctx.enlaces.sellar({ empresaId, comprobanteId, expiraEn });
      const { resultados } = await cuerposDe({
        'comprobante de B con la empresa A': sellar(A().id, aceptadoB.comprobanteId, vigente),
        'comprobante de A con la empresa B': sellar(B().id, aceptadoA.comprobanteId, vigente),
        vencido: sellar(
          A().id,
          aceptadoA.comprobanteId,
          new Date(ctx.reloj.ahora().getTime() - 60_000),
        ),
        'comprobante inexistente': sellar(A().id, randomUUID(), vigente),
        'empresa inexistente': sellar(randomUUID(), aceptadoA.comprobanteId, vigente),
        'sin PDF (por enviar)': sellar(A().id, porEnviarA.comprobanteId, vigente),
      });
      iguales(resultados);
    });
  });

  it('el sello vence solo: abre a los 29 días y es 404 pasados los 30 (con el reloj de la API)', async () => {
    await armar();
    const { sello } = await enlaceDe(aceptadoA);
    ctx.reloj.avanzar(29 * DIA);
    expect((await descargar(undefined, rutaPublica(sello))).status).toBe(200);
    ctx.reloj.avanzar(DIA + 1_000);
    const vencido = await descargar(undefined, rutaPublica(sello));
    expect(vencido.status).toBe(404);
    expect(vencido.texto).not.toContain('%PDF');
    // Un sello nuevo del mismo comprobante, pedido con sesión, vuelve a abrir.
    await A().refrescarSesiones();
    const nuevo = await enlaceDe(aceptadoA);
    expect((await descargar(undefined, rutaPublica(nuevo.sello))).status).toBe(200);
    // Y el 404 de un sello vencido es el mismo de uno alterado.
    const alterado = await descargar(undefined, rutaPublica(`${nuevo.sello}x`));
    expect(alterado.texto).toBe(vencido.texto);
  });
});

describe('criterio 160 · EnlacesComprobante.sellar y abrir', () => {
  const datos = () => ({ empresaId: randomUUID(), comprobanteId: randomUUID() });

  it('un sello se abre de vuelta con los dos ids, y no deja ver ninguno', () => {
    const d = datos();
    const sello = ctx.enlaces.sellar({
      ...d,
      expiraEn: new Date(ctx.reloj.ahora().getTime() + DIA),
    });
    expect(sello).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(sello.toLowerCase()).not.toContain(d.empresaId.toLowerCase());
    expect(sello.toLowerCase()).not.toContain(d.comprobanteId.toLowerCase());
    expect(ctx.enlaces.abrir(sello)).toMatchObject(d);
  });

  it('alterar cualquier parte del sello lo invalida (null)', () => {
    const d = datos();
    const sello = ctx.enlaces.sellar({
      ...d,
      expiraEn: new Date(ctx.reloj.ahora().getTime() + DIA),
    });
    expect(ctx.enlaces.abrir(sello)).not.toBeNull();
    const posiciones = [0, 1, 5, 13, Math.floor(sello.length / 2), sello.length - 8];
    for (const i of posiciones) {
      const malo = `${sello.slice(0, i)}${sello[i] === 'A' ? 'B' : 'A'}${sello.slice(i + 1)}`;
      expect(ctx.enlaces.abrir(malo), `posición ${i}`).toBeNull();
    }
    for (const basura of ['', 'AAAA', '%%%', sello.slice(0, -2), `${sello}AA`]) {
      expect(ctx.enlaces.abrir(basura), basura.slice(0, 10)).toBeNull();
    }
  });

  it('un sello de otra clave no se abre', () => {
    const d = datos();
    const otro = new EnlacesComprobante(
      new Cifrado({ CLAVE_CIFRADO: Buffer.alloc(32, 9).toString('base64') } as unknown as Entorno),
      ctx.reloj,
    );
    const sello = otro.sellar({ ...d, expiraEn: new Date(ctx.reloj.ahora().getTime() + DIA) });
    expect(otro.abrir(sello)).toMatchObject(d);
    expect(ctx.enlaces.abrir(sello)).toBeNull();
  });

  it('con el reloj de la API: vigente hasta su vencimiento y vencido después', () => {
    const reloj = new RelojManual('2026-11-02T10:00:00-05:00');
    const enlaces = new EnlacesComprobante(ctx.app.get(Cifrado, { strict: false }), reloj);
    const d = datos();
    const sello = enlaces.sellar({
      ...d,
      expiraEn: new Date(reloj.ahora().getTime() + DIAS_ENLACE_COMPROBANTE * DIA),
    });
    reloj.avanzar(DIAS_ENLACE_COMPROBANTE * DIA - 1_000);
    expect(enlaces.abrir(sello)).toMatchObject(d);
    reloj.avanzar(2_000);
    expect(enlaces.abrir(sello)).toBeNull();
    // Un sello que ya nace vencido tampoco abre.
    const vencido = enlaces.sellar({ ...d, expiraEn: new Date(reloj.ahora().getTime() - 1_000) });
    expect(enlaces.abrir(vencido)).toBeNull();
  });
});
