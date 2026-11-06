// spec: 006-caja-cobro (criterios 159, 160 y 165; el enlace y la ruta del PDF, prueba del desarrollador)
//
// Lo que `archivos-enlaces.spec.ts` (protegida) no cubre: la forma canónica del sello, la rotación de la clave, el PDF de un
// comprobante aceptado que aún no lo tiene, el nombre del archivo, un archivo que falta, una clave de otra empresa en la
// fila y que el rechazo del sello no dependa de la base.
import { enlaceComprobanteRespuestaSchema } from '@restaurante/contratos';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entorno } from '../../src/config/entorno';
import { EnlacesComprobante } from '../../src/modulos/facturacion';
import { Cifrado } from '../../src/nucleo/cifrado';
import { RelojManual } from '../../src/nucleo/reloj';
import {
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
  turnoDe,
  type AppFact,
  type Cobrado,
  type Escenario,
} from '../facturacion-critica/fabrica-facturacion';
import { actualizarPdfClave } from './actualizar-pdf-clave';
import { textoDelPdf } from './texto-de-pdf';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

let ctx: AppFact;
let esc: Escenario;
let restaurarBarrido: () => void;
const A = () => esc.A;
const B = () => esc.B;
const DIA = 24 * 60 * 60_000;

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

async function cobrar(e = A()): Promise<Cobrado> {
  return cobrarLomo(ctx, e, { turnoId: await turnoDe(ctx, e, 'cajero', 'S1', 'caja1') });
}
const numeroDe = (c: Cobrado) => (c.respuesta.comprobante as { numero: string }).numero;
const publico = (sello: string): Promise<Response> =>
  ctx.http().get(`/publico/comprobantes/${sello}`).buffer(true);
async function enlaceDe(c: Cobrado, e = A()): Promise<string> {
  const res = await api(
    ctx,
    e.token.supervisor,
    'get',
    `/facturacion/comprobantes/${c.comprobanteId}/enlace`,
  );
  exigirEstado(res, 200, 'GET …/enlace (006, criterio 160)');
  const cuerpo = enlaceComprobanteRespuestaSchema.parse(res.body);
  return cuerpo.url.slice(cuerpo.url.lastIndexOf('/') + 1);
}

describe('criterio 160 · la forma del sello', () => {
  const datos = () => ({
    empresaId: '11111111-1111-4111-8111-111111111111',
    comprobanteId: '22222222-2222-4222-8222-222222222222',
  });
  const futuro = () => new Date(ctx.reloj.ahora().getTime() + DIA);

  it('solo abre la forma exacta que produjo sellar: ni un carácter de más, ni el relleno cambiado, ni mayúsculas ajenas', () => {
    const sello = ctx.enlaces.sellar({ ...datos(), expiraEn: futuro() });
    expect(ctx.enlaces.abrir(sello)).toEqual(datos());
    expect(ctx.enlaces.abrir(`${sello}A`)).toBeNull();
    expect(ctx.enlaces.abrir(`${sello}=`)).toBeNull();
    expect(ctx.enlaces.abrir(` ${sello}`)).toBeNull();
    expect(ctx.enlaces.abrir(sello.replace(/-/g, '+').replace(/_/g, '/'))).toEqual(
      sello.includes('-') || sello.includes('_') ? null : datos(),
    );
    // El último carácter solo aporta algunos bits: cambiarlos no debe abrir el mismo contenido.
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
      if (c === sello.at(-1)) continue;
      expect(ctx.enlaces.abrir(`${sello.slice(0, -1)}${c}`), `último carácter ${c}`).toBeNull();
    }
  });

  it('nunca lanza: cualquier cosa que no sea un sello da null', () => {
    for (const basura of [
      '',
      ' ',
      '.',
      '..',
      '%',
      '\u0000',
      'ñ',
      '😀',
      'A'.repeat(4000),
      '-'.repeat(600),
    ]) {
      expect(ctx.enlaces.abrir(basura), basura.slice(0, 8)).toBeNull();
    }
    expect(ctx.enlaces.abrir(undefined as unknown as string)).toBeNull();
    expect(ctx.enlaces.abrir(null as unknown as string)).toBeNull();
    expect(ctx.enlaces.abrir(42 as unknown as string)).toBeNull();
  });

  it('un sello con el propósito correcto pero con otro contenido (versión, ids o fecha mal formados) no abre', () => {
    const cifrado = ctx.app.get(Cifrado, { strict: false });
    const sellarTexto = (texto: string) =>
      cifrado.sellar(texto, { proposito: 'enlace-comprobante' }).toString('base64url');
    const bueno = { v: 1, ...datos(), expiraEn: futuro().toISOString() };
    expect(ctx.enlaces.abrir(sellarTexto(JSON.stringify(bueno)))).toEqual(datos());
    for (const malo of [
      { ...bueno, v: 2 },
      { ...bueno, v: '1' },
      { ...bueno, empresaId: 'no-es-uuid' },
      { ...bueno, comprobanteId: 5 },
      { ...bueno, expiraEn: 'mañana' },
      { ...bueno, expiraEn: undefined },
      { ...bueno, expiraEn: new Date(ctx.reloj.ahora().getTime() - 1).toISOString() },
      [1, 2, 3],
      null,
      'texto',
    ]) {
      expect(ctx.enlaces.abrir(sellarTexto(JSON.stringify(malo))), JSON.stringify(malo)).toBeNull();
    }
    expect(ctx.enlaces.abrir(sellarTexto('{no es json'))).toBeNull();
  });

  it('con la clave rotada, un sello de la clave anterior sigue abriendo y lo nuevo se sella con la nueva', () => {
    const vieja = Buffer.alloc(32, 3).toString('base64');
    const nueva = Buffer.alloc(32, 4).toString('base64');
    const conVieja = new EnlacesComprobante(
      new Cifrado({ CLAVE_CIFRADO: vieja } as unknown as Entorno),
      ctx.reloj,
    );
    const rotada = new EnlacesComprobante(
      new Cifrado({ CLAVE_CIFRADO: nueva, CLAVE_CIFRADO_ANTERIOR: vieja } as unknown as Entorno),
      ctx.reloj,
    );
    const sinAnterior = new EnlacesComprobante(
      new Cifrado({ CLAVE_CIFRADO: nueva } as unknown as Entorno),
      ctx.reloj,
    );
    const selloViejo = conVieja.sellar({ ...datos(), expiraEn: futuro() });
    expect(rotada.abrir(selloViejo)).toEqual(datos());
    expect(sinAnterior.abrir(selloViejo)).toBeNull();
    const selloNuevo = rotada.sellar({ ...datos(), expiraEn: futuro() });
    expect(sinAnterior.abrir(selloNuevo)).toEqual(datos());
    expect(conVieja.abrir(selloNuevo)).toBeNull();
  });

  it('un sello fabricado a mano con el mismo algoritmo pero sin la clave derivada del propósito no abre', () => {
    // Quien conociera `CLAVE_CIFRADO` sin el HKDF del propósito tampoco podría fabricar un sello.
    const clave = Buffer.from('clave-cifrado-solo-desarrollo-32b');
    const iv = randomBytes(12);
    const cifrador = createCipheriv(
      'aes-256-gcm',
      Buffer.from(hkdfSync('sha256', clave, '', '', 32)),
      iv,
    );
    const cuerpo = Buffer.concat([
      cifrador.update(JSON.stringify({ v: 1, ...datos(), expiraEn: futuro().toISOString() })),
      cifrador.final(),
    ]);
    const falso = Buffer.concat([Buffer.from([1, 0]), iv, cifrador.getAuthTag(), cuerpo]).toString(
      'base64url',
    );
    expect(ctx.enlaces.abrir(falso)).toBeNull();
  });
});

describe('criterio 159 · GET …/pdf de un comprobante cuyo archivo no está', () => {
  it('si el archivo del PDF no está en el almacén, el PDF responde 409 PDF_NO_DISPONIBLE y el sello 404; con el archivo, 200', async () => {
    const c = await cobrar();
    await procesar(ctx, A().id, c.comprobanteId);
    const pdfClave = (await comprobanteFila(c.comprobanteId)).pdf_clave as string;
    expect(ctx.almacenC.obtener(pdfClave)).toBeDefined();
    const archivo = ctx.almacenC.obtener(pdfClave)!;
    // Sin PDF en el almacén (el archivo se perdió): el PDF y el enlace del PDF por sello no inventan nada.
    const guardado = vi.spyOn(ctx.almacenC, 'leer').mockResolvedValue(null);
    try {
      const res = await api(
        ctx,
        A().token.supervisor,
        'get',
        `/facturacion/comprobantes/${c.comprobanteId}/pdf`,
      );
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('PDF_NO_DISPONIBLE');
      const sello = await enlaceDe(c);
      const publica = await publico(sello);
      expect(publica.status).toBe(404);
      expect(publica.body.toString('utf8')).not.toContain('%PDF');
    } finally {
      guardado.mockRestore();
    }
    const ok = await publico(await enlaceDe(c));
    expect(ok.status).toBe(200);
    expect((ok.body as Buffer).equals(archivo.contenido)).toBe(true);
  });
});

describe('criterio 160 · la ruta pública', () => {
  it('responde inline con el número del comprobante como nombre de archivo y el texto del comprobante', async () => {
    const c = await cobrar();
    await procesar(ctx, A().id, c.comprobanteId);
    const res = await publico(await enlaceDe(c));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`inline; filename="${numeroDe(c)}.pdf"`);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    const texto = textoDelPdf(res.body as Buffer);
    expect(texto).toContain(numeroDe(c));
    expect(texto).toContain('Lomo saltado');
  });

  it('no sirve un archivo de otra empresa aunque la fila apunte a él (la clave debe ser de la empresa y del comprobante)', async () => {
    const deA = await cobrar(A());
    const deB = await cobrar(B());
    await procesar(ctx, A().id, deA.comprobanteId);
    await procesar(ctx, B().id, deB.comprobanteId);
    const claveDeB = (await comprobanteFila(deB.comprobanteId)).pdf_clave as string;
    expect(claveDeB.startsWith(`comprobantes/${B().id}/`)).toBe(true);
    const sello = await enlaceDe(deA);
    expect((await publico(sello)).status).toBe(200);
    // La fila de A apunta (por un error o un ataque) al archivo de B: se rechaza igual que un sello malo.
    const lectura = vi.spyOn(ctx.almacenC, 'leer');
    const original = (await comprobanteFila(deA.comprobanteId)).pdf_clave as string;
    await actualizarPdfClave(ctx, A().id, deA.comprobanteId, claveDeB);
    try {
      const res = await publico(sello);
      expect(res.status).toBe(404);
      expect((res.body as Buffer).toString('utf8')).not.toContain('%PDF');
      expect(lectura).not.toHaveBeenCalledWith(claveDeB);
    } finally {
      lectura.mockRestore();
      await actualizarPdfClave(ctx, A().id, deA.comprobanteId, original);
    }
    expect((await publico(sello)).status).toBe(200);
  });

  it('un sello mal formado se rechaza sin consultar la base ni el almacén', async () => {
    const lectura = vi.spyOn(ctx.almacenC, 'leer');
    lectura.mockClear();
    for (const malo of ['AAAA', 'A'.repeat(300), '%E0%A4%A', 'x'.repeat(40)]) {
      const res = await publico(malo);
      expect(res.status, malo).toBe(404);
    }
    expect(lectura).not.toHaveBeenCalled();
    lectura.mockRestore();
  });

  it('el sello que pidió A para un comprobante no se puede reutilizar con otro reloj adelantado: vence a los 30 días', async () => {
    const reloj = ctx.reloj as RelojManual;
    const c = await cobrar();
    await procesar(ctx, A().id, c.comprobanteId);
    const sello = await enlaceDe(c);
    reloj.avanzar(30 * DIA - 1_000);
    expect((await publico(sello)).status).toBe(200);
    reloj.avanzar(2_000);
    expect((await publico(sello)).status).toBe(404);
    await A().refrescarSesiones();
    await B().refrescarSesiones();
  });
});
