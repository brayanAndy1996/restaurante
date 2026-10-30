// Historia 004 · entrega 3b · pruebas del desarrollador (no protegidas) de la ronda 3 del ataque (la protegida
// `impresion-critica/ataque-ronda3.spec.ts` cubre la carta llena de "ﷺ" de punta a punta): un ticket de 3000
// bloques llenos de "ﷺ" sale cortado en `MAXIMO_BYTES_TICKET` con el aviso y el trabajo queda `incompleto` desde que se
// encola; 50 reimpresiones no hacen crecer `GET /puente/trabajos`; y el tope se vuelve a decidir al entregar con
// la configuración vigente de la impresora.
import {
  MAXIMO_BYTES_RESPUESTA_TRABAJOS,
  MAXIMO_BYTES_TICKET,
  trabajoResumenSchema,
  trabajoParaImprimirSchema,
  type TrabajoResumen,
} from '@restaurante/contratos';
import type { DocumentoTicket } from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ColaImpresionService } from '../../src/modulos/impresion/cola-impresion.service';
import { Cierres, arrancarP5, type AppP5 } from '../impresion-critica/fabrica-p5';
import { conClave, llamarPuente, nuevoPuente } from '../impresion-critica/fabrica-p6';
import {
  exigirEstado,
  llamar,
  prepararEscenarioP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import { abrirCliente } from '../utilidades';
import { cuerpoRed, impresoraCreada } from './ayudas-impresion';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP5;
let admin: Client;
let esc: EscenarioP2;
const cierres = new Cierres();

const A = () => esc.e.A;
const T = () => esc.token.adminA;

beforeAll(async () => {
  ctx = await arrancarP5();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
});

afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
  await admin?.end();
});

const listar = async (token: string, consulta = ''): Promise<TrabajoResumen[]> => {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: `/impresion/trabajos${consulta}` });
  exigirEstado(res, 200, `listar trabajos ${consulta}`);
  return z.array(trabajoResumenSchema).parse(res.body);
};

/** Encola un trabajo con un documento dado, como lo haría una plantilla (el actor es el sistema). */
async function encolarDocumento(
  sucursalId: string,
  impresoraId: string,
  documento: DocumentoTicket,
): Promise<string> {
  const cola = ctx.app.get(ColaImpresionService, { strict: false });
  const contexto = ctx.app.get(ContextoEmpresa, { strict: false });
  const [id] = await contexto.ejecutar(
    A().empresaId,
    () =>
      cola.encolar([
        {
          sucursalId,
          impresoraId,
          estacionId: null,
          tipo: 'COMANDA',
          comandaId: null,
          precuentaId: null,
          mesa: '4',
          ordenId: null,
          envioNumero: null,
          documento,
        },
      ]),
    { actor: { sistema: 'prueba' } },
  );
  return id!;
}

/** 3000 bloques de 200 "ﷺ": 1 carácter cada uno para el esquema, 18 al descomponerlos en NFKD. */
const documentoSalat: DocumentoTicket = {
  version: 1,
  tipo: 'COMANDA',
  bloques: Array.from({ length: 3000 }, () => ({
    tipo: 'linea' as const,
    texto: '\ufdfa'.repeat(200),
  })),
};

const bytesDe = (base64: string): number => Buffer.from(base64, 'base64').length;

describe('ronda 3 · el ticket lleno de "ﷺ" sale cortado y marcado', () => {
  it('queda incompleto desde que se encola, GET /puente/trabajos lo entrega bajo el tope con el aviso y valida con el contrato', async () => {
    const sucursalId = A().S2;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed({ anchoMm: 58 }));
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const id = await encolarDocumento(sucursalId, impresora.id, documentoSalat);

    const sesion = await sesionContrasena(ctx, A().base.admin, sucursalId);
    expect((await listar(sesion)).find((t) => t.id === id)?.incompleto).toBe(true);

    const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
    exigirEstado(res, 200, 'pedir los trabajos');
    const lote = res.body as Array<{ id: string; bytes: string }>;
    expect(lote.map((t) => t.id)).toEqual([id]);
    expect(bytesDe(lote[0]!.bytes)).toBeLessThanOrEqual(MAXIMO_BYTES_TICKET);
    expect(Buffer.from(lote[0]!.bytes, 'base64').toString('latin1')).toContain('Ticket incompleto');
    expect(trabajoParaImprimirSchema.safeParse(lote[0]).success).toBe(true);
    // El documento guardado no cambió: sin el aviso estructural.
    const { rows } = await admin.query<{ documento: DocumentoTicket }>(
      'SELECT documento FROM trabajo_impresion WHERE id = $1',
      [id],
    );
    expect(rows[0]!.documento.bloques).toHaveLength(3000);
  });

  it('50 reimpresiones: cada respuesta pesa a lo más el tope más un ticket, y todas quedan incompletas', async () => {
    const sucursalId = A().S3!;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed({ anchoMm: 80 }));
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const original = await encolarDocumento(sucursalId, impresora.id, documentoSalat);
    const sesion = await sesionContrasena(ctx, A().base.admin, sucursalId);
    const ids = [original];
    for (let i = 0; i < 50; i += 1) {
      const res = await conClave(
        ctx,
        sesion,
        'post',
        `/impresion/trabajos/${original}/reimpresion`,
      );
      exigirEstado(res, 201, `reimprimir ${i + 1}`);
      ids.push(res.body.trabajoId as string);
    }
    const lista = await listar(sesion);
    for (const id of ids) expect(lista.find((t) => t.id === id)?.incompleto, id).toBe(true);

    const entregados: string[] = [];
    for (let vuelta = 0; vuelta < 60 && entregados.length < ids.length; vuelta += 1) {
      const inicio = performance.now();
      const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
      const ms = performance.now() - inicio;
      exigirEstado(res, 200, 'pedir los trabajos');
      const lote = res.body as Array<{ id: string; bytes: string }>;
      const bytes = lote.reduce((n, t) => n + bytesDe(t.bytes), 0);
      expect(bytes).toBeLessThanOrEqual(MAXIMO_BYTES_RESPUESTA_TRABAJOS + MAXIMO_BYTES_TICKET);
      expect(Buffer.byteLength(res.text, 'utf8')).toBeLessThan(2_000_000);
      expect(ms).toBeLessThan(5000);
      expect(lote.length).toBeGreaterThan(0);
      for (const t of lote) {
        expect(trabajoParaImprimirSchema.safeParse(t).success).toBe(true);
        entregados.push(t.id);
        exigirEstado(
          await llamarPuente(ctx, puente.token, 'post', `/puente/trabajos/${t.id}/resultado`, {
            resultado: 'IMPRESO',
          }),
          200,
          'reportar impreso',
        );
      }
    }
    // El reloj de la prueba está fijo: mismo instante de creación, así que salen por id; lo que importa es que salen todos.
    expect(entregados).toHaveLength(ids.length);
    expect([...entregados].sort()).toEqual([...ids].sort());
  });

  it('si el ticket pasa del tope solo con la configuración vigente al entregar, se marca incompleto al entregarlo', async () => {
    const sucursalId = A().S1;
    // WPC1252 escribe "…" en un byte; PC437 no lo tiene y lo escribe como "...": el mismo documento triplica su peso.
    const impresora = await impresoraCreada(
      ctx,
      T(),
      sucursalId,
      cuerpoRed({ anchoMm: 80, juegoCaracteres: 'WPC1252' }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const documento: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: Array.from({ length: 1000 }, () => ({
        tipo: 'linea' as const,
        texto: '…'.repeat(200),
      })),
    };
    const id = await encolarDocumento(sucursalId, impresora.id, documento);
    const sesion = await sesionContrasena(ctx, A().base.admin, sucursalId);
    expect((await listar(sesion)).find((t) => t.id === id)?.incompleto).toBe(false);
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${sucursalId}/impresoras/${impresora.id}`,
        cuerpo: { juegoCaracteres: 'PC437' },
      }),
      200,
      'cambiar el juego de caracteres',
    );
    const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
    exigirEstado(res, 200, 'pedir los trabajos');
    const lote = res.body as Array<{ id: string; bytes: string }>;
    expect(bytesDe(lote[0]!.bytes)).toBeLessThanOrEqual(MAXIMO_BYTES_TICKET);
    expect(Buffer.from(lote[0]!.bytes, 'base64').toString('latin1')).toContain('Ticket incompleto');
    expect((await listar(sesion)).find((t) => t.id === id)?.incompleto).toBe(true);
  });
});
