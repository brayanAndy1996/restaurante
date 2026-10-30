// Historia 004 · entrega 3b · pruebas del desarrollador (no protegidas) de las correcciones de la ronda 2 del ataque
// (la protegida `impresion-critica/ataque-ronda2.spec.ts` cubre F1 a F5 de punta a punta; aquí lo que ella no mira):
// el trabajo `incompleto` en la lista y en la reimpresión, la cabecera `X-Puente-Hay-Mas` y el mínimo de un trabajo
// por impresora, el tope de impresoras activas por sucursal y `?ordenId=` con mayúsculas.
import {
  MAXIMO_IMPRESORAS_LATIDO,
  trabajoResumenSchema,
  type TrabajoResumen,
} from '@restaurante/contratos';
import type { DocumentoTicket } from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ColaImpresionService } from '../../src/modulos/impresion/cola-impresion.service';
import { Cierres, arrancarP5, type AppP5 } from '../impresion-critica/fabrica-p5';
import {
  conClave,
  llamarPuente,
  nuevoPuente,
  trabajosDelPuente,
} from '../impresion-critica/fabrica-p6';
import {
  abrirOrden,
  enviarOk,
  exigirEstado,
  lineasDe,
  llamar,
  prepararEscenarioP2,
  unirMesasOk,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import { cuerpoRed, impresoraCreada, unico } from './ayudas-impresion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

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

/** Un documento de `n` bloques de 190 caracteres: unos 25 KB de ESC/POS por cada 100 bloques en 80 mm. */
const documentoGrande = (n: number, etiqueta: string): DocumentoTicket => ({
  version: 1,
  tipo: 'COMANDA',
  bloques: Array.from({ length: n }, (_, i) => ({
    tipo: 'linea' as const,
    texto: `${etiqueta} ${i} ${'palabra '.repeat(30)}`.slice(0, 190).trim(),
  })),
});

const AVISO_INCOMPLETO = {
  tipo: 'linea' as const,
  texto: '... Ticket incompleto: faltan 7 líneas. Revisa la cuenta en la app.',
  negrita: true,
  aviso: 'INCOMPLETO' as const,
};

describe('F1 · el trabajo incompleto se marca y la reimpresión lo conserva', () => {
  it('la lista dice incompleto solo si el documento termina con el aviso del sistema, y la reimpresión también', async () => {
    const sucursalId = A().S3!;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed());
    const incompleto = await encolarDocumento(sucursalId, impresora.id, {
      version: 1,
      tipo: 'COMANDA',
      bloques: [{ tipo: 'linea', texto: 'Lomo' }, AVISO_INCOMPLETO],
    });
    // Un texto igual al aviso, pero escrito como cualquier línea, no marca el trabajo.
    const parecido = await encolarDocumento(sucursalId, impresora.id, {
      version: 1,
      tipo: 'COMANDA',
      bloques: [{ tipo: 'linea', texto: AVISO_INCOMPLETO.texto }],
    });
    const normal = await encolarDocumento(sucursalId, impresora.id, {
      version: 1,
      tipo: 'COMANDA',
      bloques: [{ tipo: 'linea', texto: 'Lomo' }],
    });

    const lista = await listar(esc.token.adminA);
    expect(lista.find((t) => t.id === incompleto)?.incompleto).toBe(true);
    expect(lista.find((t) => t.id === parecido)?.incompleto).toBe(false);
    expect(lista.find((t) => t.id === normal)?.incompleto).toBe(false);

    const res = await conClave(ctx, T(), 'post', `/impresion/trabajos/${incompleto}/reimpresion`);
    exigirEstado(res, 201, 'reimprimir el incompleto');
    const reimpreso = res.body.trabajoId as string;
    const despues = await listar(esc.token.adminA);
    expect(despues.find((t) => t.id === reimpreso)).toMatchObject({
      reimpresionDe: incompleto,
      incompleto: true,
    });
  });
});

describe('F5 · el tope de bytes de GET /puente/trabajos', () => {
  it('con trabajos de sobra, la respuesta se corta sin pasar el tope, lleva X-Puente-Hay-Mas y lo que falta sale después, en orden', async () => {
    const sucursalId = A().S2;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed({ anchoMm: 80 }));
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    // Cada trabajo pesa unos 100 KB (400 bloques): 12 pasan del tope de 1 MB.
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(await encolarDocumento(sucursalId, impresora.id, documentoGrande(400, `T${i}`)));
    }
    const entregados: string[] = [];
    let vueltas = 0;
    let hayMasEnAlguna = false;
    for (;;) {
      vueltas += 1;
      const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
      exigirEstado(res, 200, 'pedir los trabajos');
      const lote = res.body as Array<{ id: string; bytes: string }>;
      if (lote.length === 0) break;
      const bytes = lote.reduce((n, t) => n + Buffer.from(t.bytes, 'base64').length, 0);
      expect(bytes).toBeLessThanOrEqual(1_000_000);
      const hayMas = res.headers['x-puente-hay-mas'] === '1';
      if (hayMas) hayMasEnAlguna = true;
      for (const t of lote) {
        entregados.push(t.id);
        exigirEstado(
          await llamarPuente(ctx, puente.token, 'post', `/puente/trabajos/${t.id}/resultado`, {
            resultado: 'IMPRESO',
          }),
          200,
          'reportar impreso',
        );
      }
      // Sin la cabecera la respuesta cabía entera: no queda nada que esperar.
      if (!hayMas) {
        expect(lote.length).toBeLessThan(20);
      }
      expect(vueltas).toBeLessThan(10);
    }
    expect(hayMasEnAlguna).toBe(true);
    expect(entregados).toEqual(ids);
  });

  it('un trabajo que por sí solo pasa el tope sale igual: al menos uno por impresora', async () => {
    const sucursalId = A().S1;
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const uno = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed({ anchoMm: 58 }));
    const dos = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed({ anchoMm: 58 }));
    // 3000 bloques de 190 caracteres en 58 mm: más de medio MB cada uno, juntos pasan el tope.
    const a = await encolarDocumento(sucursalId, uno.id, documentoGrande(3000, 'A'));
    const b = await encolarDocumento(sucursalId, dos.id, documentoGrande(3000, 'B'));
    const res = await llamarPuente(ctx, puente.token, 'get', '/puente/trabajos');
    exigirEstado(res, 200, 'pedir los trabajos');
    const lote = res.body as Array<{ id: string; impresoraId: string; bytes: string }>;
    expect(lote.map((t) => t.id)).toEqual([a, b]);
    const bytes = lote.reduce((n, t) => n + Buffer.from(t.bytes, 'base64').length, 0);
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(res.headers['x-puente-hay-mas']).toBeUndefined();
    // Y un tercer trabajo de la primera impresora espera: ya llegó al tope.
    const c = await encolarDocumento(sucursalId, uno.id, documentoGrande(10, 'C'));
    const siguiente = (await trabajosDelPuente(ctx, puente)).map((t) => t.id);
    expect(siguiente).toEqual([a, b]);
    expect(siguiente).not.toContain(c);
  });
});

describe('F5 · el tope de impresoras activas por sucursal', () => {
  it('la número 51 responde 409 sin crearse, y desactivar una deja crear otra; reactivar con el cupo lleno también es 409', async () => {
    const sucursalId = A().S3!;
    const activas = async (): Promise<number> =>
      Number(
        (
          await admin.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM impresora WHERE sucursal_id = $1 AND activa',
            [sucursalId],
          )
        ).rows[0]!.n,
      );
    const creadas: string[] = [];
    while ((await activas()) < MAXIMO_IMPRESORAS_LATIDO) {
      creadas.push((await impresoraCreada(ctx, T(), sucursalId, cuerpoRed())).id);
    }
    expect(await activas()).toBe(MAXIMO_IMPRESORAS_LATIDO);
    const crear = () =>
      llamar(ctx, T(), {
        metodo: 'post',
        ruta: `/sucursales/${sucursalId}/impresoras`,
        cuerpo: cuerpoRed({ nombre: unico('Una de mas') }),
      });
    const rechazada = await crear();
    expect(rechazada.status).toBe(409);
    expect(rechazada.body.codigo).toBe('CONFLICTO');
    expect(rechazada.body.mensaje).toMatch(/50 impresoras activas/);
    expect(await activas()).toBe(MAXIMO_IMPRESORAS_LATIDO);

    // Desactivar una libera el cupo.
    const quitada = creadas[0]!;
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${sucursalId}/impresoras/${quitada}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar una impresora',
    );
    const nueva = await crear();
    exigirEstado(nueva, 201, 'crear con el cupo libre');
    // Ahora está lleno otra vez: reactivar la desactivada pasa del tope.
    const reactivar = await llamar(ctx, T(), {
      metodo: 'patch',
      ruta: `/sucursales/${sucursalId}/impresoras/${quitada}`,
      cuerpo: { activa: true },
    });
    expect(reactivar.status).toBe(409);
    expect(await activas()).toBe(MAXIMO_IMPRESORAS_LATIDO);
  });

  it('el tope es por sucursal: otra sucursal de la misma empresa sigue creando', async () => {
    const otra = await impresoraCreada(ctx, T(), A().S1, cuerpoRed());
    expect(otra.sucursalId).toBe(A().S1);
  });
});

describe('F3 · ?ordenId= sin importar las mayúsculas del id', () => {
  it('una orden unida sigue vacía y la principal trae los trabajos de las dos, también con el id en mayúsculas', async () => {
    const sucursalId = A().S1;
    const L = lineasDe(esc.carta);
    const cocina = await impresoraCreada(
      ctx,
      T(),
      sucursalId,
      cuerpoRed({ nombre: unico('Cocina') }),
    );
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${sucursalId}/estaciones-destino/${esc.carta.cocinaId}`,
        cuerpo: { destino: 'IMPRESORA', impresoraId: cocina.id },
      }),
      200,
      'Cocina a la impresora',
    );
    const mozo = esc.token.mozo;
    try {
      const principal = await abrirOrden(ctx, esc.salon, mozo);
      const absorbida = await abrirOrden(ctx, esc.salon, mozo);
      await enviarOk(ctx, mozo, principal.id, [L.lomo(['3/4'], 1)]);
      await enviarOk(ctx, mozo, absorbida.id, [L.lomo(['Jugoso'], 1)]);
      await unirMesasOk(ctx, mozo, principal.id, [absorbida.mesaId]);
      const ordenes = async (id: string) =>
        (await listar(mozo, `?ordenId=${id}`)).map((t) => t.ordenId);
      expect(await ordenes(absorbida.id)).toEqual([]);
      expect(await ordenes(absorbida.id.toUpperCase())).toEqual([]);
      expect(await ordenes(principal.id)).toEqual([principal.id, principal.id]);
      expect(await ordenes(principal.id.toUpperCase())).toEqual([principal.id, principal.id]);
    } finally {
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${sucursalId}/estaciones-destino/${esc.carta.cocinaId}`,
        cuerpo: { destino: 'KDS' },
      });
    }
  });
});
