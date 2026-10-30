// Historia 004 · entrega 3b · pruebas del desarrollador (no protegidas) de las correcciones de la ronda 1 del ataque
// y de la revisión: trabajos sin ticket (F1), reparto de la entrega por impresora (F3, cubierto por la protegida
// `ataque-ronda1.spec.ts`; aquí lo que ella no mira), lista de trabajos filtrada antes del límite y por cuenta (I2),
// `API_URL_PUBLICA` ausente (I3), claves de `destinosVisibles` (M6), un solo trabajo de emisión por pre-cuenta (M8),
// estado de las impresoras Bluetooth y de las que cambian de conexión, y revocación de un puente conectado.
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  estadoImpresionRespuestaSchema,
  precuentaRespuestaSchema,
  trabajoResumenSchema,
  type TrabajoResumen,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ENTORNO } from '../../src/config/entorno';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ServidorTiempoReal } from '../../src/nucleo/tiempo-real';
import { AutenticacionPuenteService } from '../../src/modulos/impresion/autenticacion-puente.service';
import { ColaImpresionService } from '../../src/modulos/impresion/cola-impresion.service';
import { PuentesService } from '../../src/modulos/impresion/puentes.service';
import { enTransaccion } from '../aislamiento/fabrica';
import { sesionContrasena } from '../carta-critica/fabrica-permisos-carta';
import {
  Cierres,
  arrancarP5,
  conectarSocketDelPuente,
  esperarHasta,
  type AppP5,
} from '../impresion-critica/fabrica-p5';
import {
  crearPrueba,
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
  pedirPrecuenta,
  prepararEscenarioP2,
  unirMesasOk,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import { cuerpoBluetooth, cuerpoRed, impresoraCreada, unico } from './ayudas-impresion';

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

/** Una escritura directa en la base (con el actor que exige la trazabilidad), confirmada. */
const escribir = (sql: string, parametros: unknown[] = []) =>
  enTransaccion(admin, A().empresaId, () => admin.query(sql, parametros), { confirmar: true });

const listar = async (token: string, consulta = ''): Promise<TrabajoResumen[]> => {
  const res = await llamar(ctx, token, { metodo: 'get', ruta: `/impresion/trabajos${consulta}` });
  exigirEstado(res, 200, `listar trabajos ${consulta}`);
  return z.array(trabajoResumenSchema).parse(res.body);
};

describe('I2 · la lista de trabajos filtra antes del límite y por cuenta (criterio 128)', () => {
  it('el filtro estado se aplica en la consulta: un IMPRESO viejo aparece aunque haya más de 200 trabajos nuevos', async () => {
    const sucursalId = A().S2;
    const mozo = esc.token.mozoS2;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed());
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const impreso = await crearPrueba(ctx, T(), sucursalId, impresora.id);
    expect(
      (
        await llamarPuente(ctx, puente.token, 'post', `/puente/trabajos/${impreso}/resultado`, {
          resultado: 'IMPRESO',
        })
      ).status,
    ).toBe(200);
    ctx.reloj.avanzar(1000);
    // 205 trabajos más nuevos: ocupan toda la lista sin filtro (el límite es 200).
    await escribir(
      `INSERT INTO trabajo_impresion (empresa_id, sucursal_id, impresora_id, tipo, documento, estado, dia_operativo,
                                      creado_en, actualizado_en)
       SELECT t.empresa_id, t.sucursal_id, t.impresora_id, 'PRUEBA', t.documento, 'PENDIENTE', t.dia_operativo,
              t.creado_en + (g || ' seconds')::interval, t.creado_en + (g || ' seconds')::interval
         FROM trabajo_impresion t, generate_series(1, 205) g
        WHERE t.id = $1`,
      [impreso],
    );
    const todos = await listar(mozo);
    expect(todos).toHaveLength(200);
    expect(todos.map((t) => t.id)).not.toContain(impreso);

    const soloImpresos = await listar(mozo, '?estado=IMPRESO');
    expect(soloImpresos.map((t) => t.id)).toEqual([impreso]);
    const pendientes = await listar(mozo, '?estado=PENDIENTE');
    expect(pendientes).toHaveLength(200);
    expect(pendientes.every((t) => t.estado === 'PENDIENTE')).toBe(true);
    expect(await listar(mozo, '?estado=VENCIDO')).toEqual([]);
  });

  it('ordenId deja solo los trabajos de esa cuenta, con las órdenes que se le unieron', async () => {
    const L = lineasDe(esc.carta);
    const cocina = await impresoraCreada(ctx, T(), A().S1, cuerpoRed({ nombre: unico('Cocina') }));
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S1}/estaciones-destino/${esc.carta.cocinaId}`,
        cuerpo: { destino: 'IMPRESORA', impresoraId: cocina.id },
      }),
      200,
      'Cocina a la impresora',
    );
    const mozo = esc.token.mozo;
    try {
      const principal = await abrirOrden(ctx, esc.salon, mozo);
      const absorbida = await abrirOrden(ctx, esc.salon, mozo);
      const aparte = await abrirOrden(ctx, esc.salon, mozo);
      await enviarOk(ctx, mozo, principal.id, [L.lomo(['3/4'], 1)]);
      await enviarOk(ctx, mozo, absorbida.id, [L.lomo(['Jugoso'], 1)]);
      await enviarOk(ctx, mozo, aparte.id, [L.lomo(['Bien cocido'], 1)]);

      const deLaCuenta = async (ordenId: string) => {
        const lista = await listar(mozo, `?ordenId=${ordenId}`);
        return lista.map((t) => t.ordenId);
      };
      expect(await deLaCuenta(principal.id)).toEqual([principal.id]);
      expect(await deLaCuenta(aparte.id)).toEqual([aparte.id]);
      expect(await deLaCuenta(randomUUID())).toEqual([]);

      await unirMesasOk(ctx, mozo, principal.id, [absorbida.mesaId]);
      // Los tickets de la absorbida son de la cuenta principal, que los ve con su orden vigente.
      const unida = await deLaCuenta(principal.id);
      expect(unida).toHaveLength(2);
      expect(unida.every((id) => id === principal.id)).toBe(true);
      // Ronda 2 (F3): la orden absorbida ya no es una cuenta; sus trabajos son de la principal.
      expect(await deLaCuenta(absorbida.id)).toEqual([]);
      expect(await deLaCuenta(aparte.id)).toEqual([aparte.id]);
      // Junto con el estado, y un ordenId mal formado es 400.
      expect(await listar(mozo, `?ordenId=${principal.id}&estado=IMPRESO`)).toEqual([]);
      expect(
        (await llamar(ctx, mozo, { metodo: 'get', ruta: '/impresion/trabajos?ordenId=x' })).status,
      ).toBe(400);
    } finally {
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S1}/estaciones-destino/${esc.carta.cocinaId}`,
        cuerpo: { destino: 'KDS' },
      });
    }
  });
});

describe('F1 · un trabajo sin ticket no ocupa la cola y se ve en la lista', () => {
  it('encolar guarda el documento inválido con su error, sin entregarlo, sin contarlo y sin frenar a los demás', async () => {
    const sucursalId = A().S3!;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed());
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const cola = ctx.app.get(ColaImpresionService, { strict: false });
    const contexto = ctx.app.get(ContextoEmpresa, { strict: false });
    const invalido = {
      version: 1,
      tipo: 'PRUEBA',
      bloques: [{ tipo: 'linea', texto: 'x'.repeat(250) }],
    };
    const [malo] = await contexto.ejecutar(
      A().empresaId,
      () =>
        cola.encolar([
          {
            sucursalId,
            impresoraId: impresora.id,
            estacionId: null,
            tipo: 'PRUEBA',
            comandaId: null,
            precuentaId: null,
            mesa: null,
            ordenId: null,
            envioNumero: null,
            documento: invalido as never,
          },
        ]),
      { actor: { sistema: 'prueba' } },
    );
    const bueno = await crearPrueba(ctx, T(), sucursalId, impresora.id);

    const fila = (
      await admin.query<{ estado: string; error_render: string | null }>(
        'SELECT estado, error_render FROM trabajo_impresion WHERE id = $1',
        [malo],
      )
    ).rows[0]!;
    expect(fila.estado).toBe('PENDIENTE');
    expect(fila.error_render).toMatch(/^Documento inválido/);

    const entregados = (await trabajosDelPuente(ctx, puente)).map((t) => t.id);
    expect(entregados).toContain(bueno);
    expect(entregados).not.toContain(malo);

    // El banner no lo cuenta: solo el bueno espera a la impresora.
    const sesion = await sesionContrasena(ctx, A().base.admin, sucursalId);
    const estado = estadoImpresionRespuestaSchema.parse(
      (await llamar(ctx, sesion, { metodo: 'get', ruta: '/impresion/estado' })).body,
    );
    expect(estado.impresoras.find((i) => i.id === impresora.id)?.pendientes).toBe(1);

    // "Trabajos de hoy" lo muestra con su error.
    const lista = await listar(sesion);
    expect(lista.find((t) => t.id === malo)).toMatchObject({
      estado: 'PENDIENTE',
      sinTicket: true,
      ultimoError: expect.stringMatching(/^Documento inválido/),
    });
    expect(lista.find((t) => t.id === bueno)).toMatchObject({ sinTicket: false });
  });

  it('un documento que no se puede armar al entregar queda marcado y no vuelve a entregarse', async () => {
    const sucursalId = A().S3!;
    const impresora = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed());
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const roto = await crearPrueba(ctx, T(), sucursalId, impresora.id);
    const sano = await crearPrueba(ctx, T(), sucursalId, impresora.id);
    await escribir(
      `UPDATE trabajo_impresion SET documento = '{"version": 9}'::jsonb WHERE id = $1`,
      [roto],
    );
    const primera = (await trabajosDelPuente(ctx, puente)).map((t) => t.id);
    expect(primera).toContain(sano);
    expect(primera).not.toContain(roto);
    const fila = (
      await admin.query<{ error_render: string | null; entregado_en: Date | null }>(
        'SELECT error_render, entregado_en FROM trabajo_impresion WHERE id = $1',
        [roto],
      )
    ).rows[0]!;
    expect(fila.error_render).toMatch(/Versión de documento/);
    expect(fila.entregado_en).toBeNull();
    expect((await trabajosDelPuente(ctx, puente)).map((t) => t.id)).not.toContain(roto);
  });

  it('una pre-cuenta de 20 mesas con nombres largos responde 201 y su columna mesa queda recortada con "…"', async () => {
    const sesion = await sesionContrasena(ctx, A().base.admin, A().S2);
    void sesion;
    const caja = await impresoraCreada(ctx, T(), A().S2, cuerpoRed({ nombre: unico('Caja') }));
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S2}/impresion`,
        cuerpo: { impresoraCajaId: caja.id },
      }),
      200,
      'impresora de caja',
    );
    const L = lineasDe(esc.carta);
    const mozo = esc.token.mozoS2;
    const orden = await abrirOrden(ctx, esc.salonS2, mozo);
    await enviarOk(ctx, mozo, orden.id, [L.gaseosa(1)]);
    const cola = ctx.app.get(ColaImpresionService, { strict: false });
    const contexto = ctx.app.get(ContextoEmpresa, { strict: false });
    const mesaLarga = Array.from({ length: 20 }, (_, i) => `Salon ${i} ${'q'.repeat(12)}`).join(
      ', ',
    );
    expect(mesaLarga.length).toBeGreaterThan(300);
    const [id] = await contexto.ejecutar(
      A().empresaId,
      async () =>
        cola.encolar([
          {
            sucursalId: A().S2,
            impresoraId: caja.id,
            estacionId: null,
            tipo: 'PRUEBA',
            comandaId: null,
            precuentaId: null,
            mesa: mesaLarga,
            ordenId: orden.id,
            envioNumero: null,
            documento: { version: 1, tipo: 'PRUEBA', bloques: [{ tipo: 'regla' }] },
          },
        ]),
      { actor: { sistema: 'prueba' } },
    );
    const mesa = (
      await admin.query<{ mesa: string }>('SELECT mesa FROM trabajo_impresion WHERE id = $1', [id])
    ).rows[0]!.mesa;
    expect(Array.from(mesa)).toHaveLength(300);
    expect(mesa.endsWith('…')).toBe(true);
    expect(mesaLarga.startsWith(mesa.slice(0, -1))).toBe(true);
    const pre = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(pre, 201, 'pre-cuenta');
    await llamar(ctx, T(), {
      metodo: 'put',
      ruta: `/sucursales/${A().S2}/impresion`,
      cuerpo: { impresoraCajaId: null },
    });
  });
});

describe('M8 · un solo trabajo de emisión por pre-cuenta', () => {
  it('un segundo trabajo de la misma pre-cuenta lo rechaza el índice; la reimpresión sí se permite', async () => {
    const caja = await impresoraCreada(ctx, T(), A().S2, cuerpoRed({ nombre: unico('Caja') }));
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S2}/impresion`,
        cuerpo: { impresoraCajaId: caja.id },
      }),
      200,
      'impresora de caja',
    );
    const L = lineasDe(esc.carta);
    const mozo = esc.token.mozoS2;
    const orden = await abrirOrden(ctx, esc.salonS2, mozo);
    await enviarOk(ctx, mozo, orden.id, [L.lomo(['3/4'], 1)]);
    const pre = await pedirPrecuenta(ctx, mozo, orden.id);
    exigirEstado(pre, 201, 'pre-cuenta');
    const { id: precuentaId, trabajoId } = precuentaRespuestaSchema.parse(pre.body);

    const duplicar = (reimpresionDe: string | null) =>
      escribir(
        `INSERT INTO trabajo_impresion (empresa_id, sucursal_id, impresora_id, tipo, documento, precuenta_id,
                                        reimpresion_de_id, orden_id, estado, dia_operativo)
         SELECT empresa_id, sucursal_id, impresora_id, tipo, documento, precuenta_id, $2::uuid, orden_id,
                'PENDIENTE', dia_operativo
           FROM trabajo_impresion WHERE id = $1`,
        [trabajoId, reimpresionDe],
      );
    await expect(duplicar(null)).rejects.toMatchObject({
      code: '23505',
      constraint: 'trabajo_impresion_precuenta_unico',
    });
    await duplicar(trabajoId!);
    const { rows } = await admin.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM trabajo_impresion WHERE precuenta_id = $1',
      [precuentaId],
    );
    expect(rows[0]!.n).toBe('2');
    await llamar(ctx, T(), {
      metodo: 'put',
      ruta: `/sucursales/${A().S2}/impresion`,
      cuerpo: { impresoraCajaId: null },
    });
  });
});

describe('M6 · destinosVisibles', () => {
  it('con una lista vacía no consulta, y las claves son los ids pedidos, como en destinos', async () => {
    const cola = ctx.app.get(ColaImpresionService, { strict: false });
    const contexto = ctx.app.get(ContextoEmpresa, { strict: false });
    const impresora = await impresoraCreada(
      ctx,
      T(),
      A().S1,
      cuerpoRed({ nombre: unico('Barra') }),
    );
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S1}/estaciones-destino/${esc.carta.barraId}`,
        cuerpo: { destino: 'IMPRESORA', impresoraId: impresora.id },
      }),
      200,
      'Barra a la impresora',
    );
    try {
      const idMayusculas = esc.carta.barraId.toUpperCase();
      const otra = randomUUID();
      const resultado = await contexto.ejecutar(
        A().empresaId,
        async () => ({
          vacia: await cola.destinosVisibles(A().S1, []),
          visibles: await cola.destinosVisibles(A().S1, [idMayusculas, otra]),
          destinos: await cola.destinos(A().S1, [idMayusculas, otra]),
        }),
        { actor: { sistema: 'prueba' } },
      );
      expect(resultado.vacia.size).toBe(0);
      expect([...resultado.visibles.keys()]).toEqual([idMayusculas, otra]);
      expect([...resultado.visibles.keys()]).toEqual([...resultado.destinos.keys()]);
      expect(resultado.visibles.get(idMayusculas)).toEqual({
        destino: 'IMPRESORA',
        impresora: { id: impresora.id, nombre: impresora.nombre },
      });
      expect(resultado.visibles.get(otra)).toEqual({ destino: 'KDS' });
    } finally {
      await llamar(ctx, T(), {
        metodo: 'put',
        ruta: `/sucursales/${A().S1}/estaciones-destino/${esc.carta.barraId}`,
        cuerpo: { destino: 'KDS' },
      });
    }
  });
});

describe('I3 · API_URL_PUBLICA ausente', () => {
  it('crear una vinculación responde 503 CONFIGURACION_INCOMPLETA sin crear nada y el arranque avisa con un warn', async () => {
    const entorno = ctx.app.get(ENTORNO, { strict: false }) as {
      API_URL_PUBLICA: string | undefined;
    };
    const original = entorno.API_URL_PUBLICA;
    const antes = (
      await admin.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM vinculacion_puente WHERE sucursal_id = $1',
        [A().S1],
      )
    ).rows[0]!.n;
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    entorno.API_URL_PUBLICA = undefined;
    try {
      const res = await llamar(ctx, T(), {
        metodo: 'post',
        ruta: `/sucursales/${A().S1}/vinculaciones-puente`,
      });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ codigo: 'CONFIGURACION_INCOMPLETA' });
      const despues = (
        await admin.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM vinculacion_puente WHERE sucursal_id = $1',
          [A().S1],
        )
      ).rows[0]!.n;
      expect(despues).toBe(antes);

      ctx.app.get(PuentesService, { strict: false }).onApplicationBootstrap();
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('API_URL_PUBLICA'));
    } finally {
      entorno.API_URL_PUBLICA = original;
      aviso.mockRestore();
    }
    // Con la variable, de nuevo 201 y sin avisos.
    const ok = await llamar(ctx, T(), {
      metodo: 'post',
      ruta: `/sucursales/${A().S1}/vinculaciones-puente`,
    });
    expect(ok.status).toBe(201);
  });
});

describe('F6 · el código de vinculación no queda en la idempotencia', () => {
  it('la ruta ignora la Idempotency-Key: dos pedidos con la misma clave crean dos códigos y no se guarda la respuesta', async () => {
    const clave = randomUUID();
    const pedir = () =>
      llamar(ctx, T(), {
        metodo: 'post',
        ruta: `/sucursales/${A().S1}/vinculaciones-puente`,
        cabeceras: { 'Idempotency-Key': clave },
      });
    const uno = await pedir();
    const dos = await pedir();
    expect(uno.status).toBe(201);
    expect(dos.status).toBe(201);
    expect(dos.body.token).not.toBe(uno.body.token);
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM idempotencia WHERE respuesta::text LIKE '%' || $1 || '%'`,
      [String(uno.body.token).split('.')[3]],
    );
    expect(rows[0]!.n).toBe('0');
  });
});

describe('estado de las impresoras Bluetooth y de las que cambian de conexión (criterio 120)', () => {
  it('el latido no guarda el estado de una Bluetooth y el cambio de conexión reinicia el de una impresora de red', async () => {
    const sucursalId = A().S3!;
    const sesion = await sesionContrasena(ctx, A().base.admin, sucursalId);
    const red = await impresoraCreada(ctx, T(), sucursalId, cuerpoRed());
    const bluetooth = await impresoraCreada(ctx, T(), sucursalId, cuerpoBluetooth());
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const latir = async (impresoras: { id: string; estado: 'LISTA' | 'NO_RESPONDE' }[]) =>
      expect(
        (
          await llamarPuente(ctx, puente.token, 'post', '/puente/latido', {
            versionApp: '1.0.0',
            impresoras,
          })
        ).status,
      ).toBe(204);
    const estado = async () =>
      new Map(
        estadoImpresionRespuestaSchema
          .parse((await llamar(ctx, sesion, { metodo: 'get', ruta: '/impresion/estado' })).body)
          .impresoras.map((i) => [i.id, i]),
      );
    const guardado = async () =>
      (
        await admin.query<{ estado_impresoras: Record<string, unknown> }>(
          'SELECT estado_impresoras FROM puente WHERE id = $1',
          [puente.id],
        )
      ).rows[0]!.estado_impresoras;

    await latir([
      { id: red.id, estado: 'LISTA' },
      { id: bluetooth.id, estado: 'LISTA' },
    ]);
    let e = await estado();
    expect(e.get(red.id)).toMatchObject({ estado: 'LISTA' });
    expect(e.get(bluetooth.id)).toMatchObject({ estado: 'DESCONOCIDO', estadoDesde: null });
    expect(Object.keys(await guardado())).toEqual([red.id]);

    // Un estado viejo de una Bluetooth (de antes de esta regla) tampoco se muestra.
    await escribir(
      `UPDATE puente SET estado_impresoras = estado_impresoras || jsonb_build_object($2::text, '{"estado":"LISTA","desde":"2026-01-01T00:00:00.000Z"}'::jsonb) WHERE id = $1`,
      [puente.id, bluetooth.id],
    );
    expect((await estado()).get(bluetooth.id)).toMatchObject({ estado: 'DESCONOCIDO' });

    // Cambiar cómo se conecta la de red reinicia su estado y avisa; el siguiente latido lo vuelve a fijar.
    ctx.publicador.limpiar();
    const cambio = await llamar(ctx, T(), {
      metodo: 'patch',
      ruta: `/sucursales/${sucursalId}/impresoras/${red.id}`,
      cuerpo: { conexion: { tipo: 'RED', host: '192.168.1.99', puerto: 9100 } },
    });
    exigirEstado(cambio, 200, 'cambiar el host');
    e = await estado();
    expect(e.get(red.id)).toMatchObject({ estado: 'DESCONOCIDO', estadoDesde: null });
    expect(
      ctx.publicador.eventos().filter((x) => x.nombre === 'impresion.estado'),
      'avisa que el estado cambió',
    ).toHaveLength(1);
    expect(Object.keys(await guardado())).not.toContain(red.id);
    await latir([{ id: red.id, estado: 'NO_RESPONDE' }]);
    expect((await estado()).get(red.id)).toMatchObject({ estado: 'NO_RESPONDE' });

    // Un cambio que no toca la conexión (el nombre) no reinicia nada.
    ctx.publicador.limpiar();
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${sucursalId}/impresoras/${red.id}`,
        cuerpo: { nombre: unico('Nueva') },
      }),
      200,
      'cambiar el nombre',
    );
    expect((await estado()).get(red.id)).toMatchObject({ estado: 'NO_RESPONDE' });
    expect(ctx.publicador.eventos().filter((x) => x.nombre === 'impresion.estado')).toHaveLength(0);

    // Pasarla a Bluetooth la deja sin estado, y el latido que la reporte no lo fija.
    exigirEstado(
      await llamar(ctx, T(), {
        metodo: 'patch',
        ruta: `/sucursales/${sucursalId}/impresoras/${red.id}`,
        cuerpo: { conexion: { tipo: 'BLUETOOTH', mac: 'AA:BB:CC:DD:EE:01' } },
      }),
      200,
      'pasar a Bluetooth',
    );
    await latir([{ id: red.id, estado: 'LISTA' }]);
    expect((await estado()).get(red.id)).toMatchObject({ estado: 'DESCONOCIDO' });
    expect(Object.keys(await guardado())).not.toContain(red.id);
  });
});

describe('revocar un puente cierra sus conexiones aunque la revocación no las alcance (criterio 108)', () => {
  it('alConectar devuelve false para un puente revocado y la revisión periódica cierra su socket', async () => {
    const sucursalId = A().S3!;
    const puente = await nuevoPuente(ctx, T(), A(), sucursalId);
    const validador = ctx.app.get(AutenticacionPuenteService, { strict: false });
    const datos = { empresaId: A().empresaId, puenteId: puente.id, sucursalId };
    expect(await validador.alConectar(datos)).toBe(true);
    expect([...(await validador.siguenActivos(A().empresaId, [puente.id, randomUUID()]))]).toEqual([
      puente.id,
    ]);

    const socket = await conectarSocketDelPuente(ctx.app, cierres, puente.token);
    await esperarHasta(() => socket.conectado, 3000, 'la conexión del puente');
    // Se revoca "por debajo": ni `desconectarPuente` ni el cierre normal corren, como en la carrera.
    await escribir(
      'UPDATE puente SET activo = false, revocado_en = now(), actualizado_en = now() WHERE id = $1',
      [puente.id],
    );
    expect(await validador.alConectar(datos)).toBe(false);
    expect([...(await validador.siguenActivos(A().empresaId, [puente.id]))]).toEqual([]);
    expect(socket.conectado).toBe(true);
    await ctx.app.get(ServidorTiempoReal, { strict: false }).revisarAhora();
    await socket.esperarDesconexion(3000);
    expect(socket.conectado).toBe(false);
  });
});
