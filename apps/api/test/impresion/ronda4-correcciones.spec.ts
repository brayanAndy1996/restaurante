// Historia 004 · entrega 3b · pruebas del desarrollador (no protegidas) de la ronda 4 del ataque (la protegida
// `impresion-critica/ataque-ronda4.spec.ts` cubre las fallas de punta a punta): la marca `incompleto` se recalcula en
// cada entrega y puede volver a `false` (F2), y el "faltan N" del ticket cortado por el tope suma lo que la plantilla
// ya había descartado (F3).
import {
  trabajoResumenSchema,
  type DocumentoTicket,
  type TrabajoResumen,
} from '@restaurante/contratos';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ColaImpresionService } from '../../src/modulos/impresion/cola-impresion.service';
import { avisoDeCorte } from '../../src/modulos/impresion/escpos/plantillas/presupuesto';
import { Cierres, arrancarP5, type AppP5 } from '../impresion-critica/fabrica-p5';
import { conClave, llamarPuente, nuevoPuente } from '../impresion-critica/fabrica-p6';
import {
  exigirEstado,
  llamar,
  prepararEscenarioP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import { cuerpoRed, impresoraCreada } from './ayudas-impresion';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

let ctx: AppP5;
let esc: EscenarioP2;
const cierres = new Cierres();
const A = () => esc.e.A;
const T = () => esc.token.adminA;

beforeAll(async () => {
  ctx = await arrancarP5();
  esc = await prepararEscenarioP2(ctx);
});
afterAll(async () => {
  await cierres.cerrarTodo();
  await ctx?.cerrar();
});

const listar = async (token: string): Promise<TrabajoResumen[]> => {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: '/impresion/trabajos' });
  exigirEstado(res, 200, 'listar trabajos');
  return z.array(trabajoResumenSchema).parse(res.body);
};

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

const cambiarJuego = async (sucursalId: string, impresoraId: string, juego: string) =>
  exigirEstado(
    await llamar(ctx, T(), {
      metodo: 'patch',
      ruta: `/sucursales/${sucursalId}/impresoras/${impresoraId}`,
      cuerpo: { juegoCaracteres: juego },
    }),
    200,
    'cambiar el juego de caracteres',
  );

/** Pide los trabajos y devuelve el texto del ticket de `id` (el resto se da por impreso). */
async function entregarYReportar(
  token: string,
  id: string,
  resultado: 'IMPRESO' | 'NO_IMPRESO',
): Promise<string> {
  const res = await llamarPuente(ctx, token, 'get', '/puente/trabajos');
  exigirEstado(res, 200, 'pedir los trabajos');
  const lote = res.body as Array<{ id: string; bytes: string }>;
  const trabajo = lote.find((t) => t.id === id);
  expect(trabajo, 'el trabajo se entregó').toBeDefined();
  for (const t of lote) {
    const cuerpo =
      t.id === id && resultado === 'NO_IMPRESO'
        ? { resultado, error: 'sin papel' }
        : { resultado: 'IMPRESO' };
    exigirEstado(
      await llamarPuente(ctx, token, 'post', `/puente/trabajos/${t.id}/resultado`, cuerpo),
      200,
      'reportar',
    );
  }
  return Buffer.from(trabajo!.bytes, 'base64').toString('latin1');
}

/** 1000 bloques de 200 "…": 1 byte cada uno en WPC1252 (200 KB), tres en PC437 (más de 256 KB). */
const documentoPuntos: DocumentoTicket = {
  version: 1,
  tipo: 'COMANDA',
  bloques: Array.from({ length: 1000 }, () => ({ tipo: 'linea' as const, texto: '…'.repeat(200) })),
};

describe('ronda 4 · F2 · incompleto se recalcula en cada entrega', () => {
  it('cortado al encolar (PC437) y entregado completo tras pasar a WPC1252: vuelve a false y la lista lo dice', async () => {
    const s = A().S1;
    const imp = await impresoraCreada(
      ctx,
      T(),
      s,
      cuerpoRed({ anchoMm: 80, juegoCaracteres: 'PC437' }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), s);
    const id = await encolarDocumento(s, imp.id, documentoPuntos);
    const sesion = await sesionContrasena(ctx, A().base.admin, s);
    expect((await listar(sesion)).find((t) => t.id === id)?.incompleto).toBe(true);

    await cambiarJuego(s, imp.id, 'WPC1252');
    const papel = await entregarYReportar(puente.token, id, 'IMPRESO');
    expect(papel).not.toContain('Ticket incompleto');
    expect((await listar(sesion)).find((t) => t.id === id)?.incompleto).toBe(false);
  });

  it('sigue el papel de ida y vuelta: completo, cortado, completo (un NO_IMPRESO lo vuelve a entregar)', async () => {
    const s = A().S2;
    const imp = await impresoraCreada(
      ctx,
      T(),
      s,
      cuerpoRed({ anchoMm: 80, juegoCaracteres: 'WPC1252' }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), s);
    const id = await encolarDocumento(s, imp.id, documentoPuntos);
    const sesion = await sesionContrasena(ctx, A().base.admin, s);
    const marca = async () => (await listar(sesion)).find((t) => t.id === id)?.incompleto;
    expect(await marca()).toBe(false);

    await cambiarJuego(s, imp.id, 'PC437');
    expect(await entregarYReportar(puente.token, id, 'NO_IMPRESO')).toContain('Ticket incompleto');
    expect(await marca()).toBe(true);

    await cambiarJuego(s, imp.id, 'WPC1252');
    expect(await entregarYReportar(puente.token, id, 'IMPRESO')).not.toContain('Ticket incompleto');
    expect(await marca()).toBe(false);
  });

  it('si la plantilla cortó el documento, sigue incompleto en cualquier entrega, y una reimpresión lo mantiene', async () => {
    const s = A().S3!;
    const imp = await impresoraCreada(
      ctx,
      T(),
      s,
      cuerpoRed({ anchoMm: 80, juegoCaracteres: 'WPC1252' }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), s);
    const documento: DocumentoTicket = {
      version: 1,
      tipo: 'COMANDA',
      bloques: [{ tipo: 'linea', texto: 'Cuerpo' }, avisoDeCorte(12)],
    };
    const id = await encolarDocumento(s, imp.id, documento);
    const sesion = await sesionContrasena(ctx, A().base.admin, s);
    const marca = async (trabajo: string) =>
      (await listar(sesion)).find((t) => t.id === trabajo)?.incompleto;
    expect(await marca(id)).toBe(true);
    expect(await entregarYReportar(puente.token, id, 'IMPRESO')).toContain('faltan');
    expect(await marca(id)).toBe(true);

    const res = await conClave(ctx, sesion, 'post', `/impresion/trabajos/${id}/reimpresion`);
    exigirEstado(res, 201, 'reimprimir');
    const copia = res.body.trabajoId as string;
    expect(await marca(copia)).toBe(true);
    await entregarYReportar(puente.token, copia, 'IMPRESO');
    expect(await marca(copia)).toBe(true);
  });

  it('la reimpresión se marca con la impresora de destino vigente, no con la del original', async () => {
    const s = A().S1;
    const imp = await impresoraCreada(
      ctx,
      T(),
      s,
      cuerpoRed({ anchoMm: 80, juegoCaracteres: 'PC437' }),
    );
    const puente = await nuevoPuente(ctx, T(), A(), s);
    const id = await encolarDocumento(s, imp.id, documentoPuntos);
    const sesion = await sesionContrasena(ctx, A().base.admin, s);
    const marca = async (trabajo: string) =>
      (await listar(sesion)).find((t) => t.id === trabajo)?.incompleto;
    expect(await marca(id)).toBe(true);

    await cambiarJuego(s, imp.id, 'WPC1252');
    const res = await conClave(ctx, sesion, 'post', `/impresion/trabajos/${id}/reimpresion`);
    exigirEstado(res, 201, 'reimprimir');
    const copia = res.body.trabajoId as string;
    // Con la impresora de ahora la copia cabe: no está incompleta. El original lo decidirá su entrega.
    expect(await marca(copia)).toBe(false);
    expect(await marca(id)).toBe(true);
    await entregarYReportar(puente.token, id, 'IMPRESO');
    expect(await marca(id)).toBe(false);
  });
});
