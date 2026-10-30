// Historia 004 · entrega 3b, grupo C7 (T37) · destino de cada estación (criterios 99 y 100), impresora de caja
// (criterio 102), `IMPRESION.destinos` en el ruteo de las comandas y el filtro del KDS (criterio 61 en 3b):
// pruebas del desarrollador (no protegidas). Los permisos de todos los roles y el aislamiento de las rutas los
// cubren las protegidas de `impresion-critica/` (cuando exista el puente, T40) y `impresoras.spec.ts`.
import { randomUUID } from 'node:crypto';
import {
  cocinaRespuestaSchema,
  estacionDestinoRespuestaSchema,
  impresionSucursalRespuestaSchema,
} from '@restaurante/contratos';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IMPRESION, type ImpresionPuerto } from '../../src/modulos/pedidos';
import {
  abrirOrden,
  arrancarP2,
  crearEnCarta,
  enviarOk,
  esperarError,
  exigirEstado,
  lineasDe,
  llamar,
  prepararEscenarioP2,
  type AppP2,
  type EscenarioP2,
} from '../salon-critica/fabrica-p2';
import { abrirCliente } from '../utilidades';
import {
  auditoriaDe,
  cuerpoRed,
  impresoraCreada,
  rutaDestino,
  rutaImpresion,
  rutaImpresoras,
  totalAuditoria,
  unico,
} from './ayudas-impresion';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let esc: EscenarioP2;

const A = () => esc.e.A;
const B = () => esc.e.B;
const T = () => esc.token.adminA;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

const destinos = (sucursalId: string, token = T()) =>
  llamar(ctx, token, { metodo: 'get', ruta: `/sucursales/${sucursalId}/estaciones-destino` });
const poner = (sucursalId: string, estacionId: string, cuerpo: unknown, token = T()) =>
  llamar(ctx, token, { metodo: 'put', ruta: rutaDestino(sucursalId, estacionId), cuerpo });
const verCaja = (sucursalId: string, token = T()) =>
  llamar(ctx, token, { metodo: 'get', ruta: rutaImpresion(sucursalId) });
const ponerCaja = (sucursalId: string, cuerpo: unknown, token = T()) =>
  llamar(ctx, token, { metodo: 'put', ruta: rutaImpresion(sucursalId), cuerpo });

const filasDestino = async (sucursalId: string, estacionId: string) =>
  (
    await admin.query(
      'SELECT * FROM estacion_destino WHERE sucursal_id = $1 AND estacion_id = $2',
      [sucursalId, estacionId],
    )
  ).rows as Record<string, unknown>[];

/** Una estación nueva en la carta de una empresa, sin productos. */
const estacionNueva = async (token: string, prefijo = 'Parrilla') =>
  crearEnCarta(ctx, token, '/carta/estaciones', { nombre: unico(prefijo) });

describe('criterio 99 · consultar los destinos', () => {
  it('una fila por estación activa de la empresa; sin configurar, KDS y sin impresora', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const parrilla = await estacionNueva(token);
    const res = await destinos(e.e.A.S1, token);
    exigirEstado(res, 200, 'GET destinos');
    const filas = (res.body as unknown[]).map((f) => estacionDestinoRespuestaSchema.parse(f));
    expect(filas.map((f) => f.estacionId).sort()).toEqual(
      [e.carta.cocinaId, e.carta.barraId, parrilla.id].sort(),
    );
    for (const f of filas) expect(f).toMatchObject({ destino: 'KDS', impresora: null });
    // Por nombre.
    expect(filas.map((f) => f.nombre)).toEqual([...filas.map((f) => f.nombre)].sort());
  });

  it('una estación desactivada no aparece, y las de B no se mezclan', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const inactiva = await estacionNueva(token, 'Vieja');
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/estaciones/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar la estación',
    );
    const ids = ((await destinos(e.e.A.S1, token)).body as { estacionId: string }[]).map(
      (f) => f.estacionId,
    );
    expect(ids).not.toContain(inactiva.id);
    expect(ids).not.toContain(e.cartaB.cocinaId);
    expect(ids.sort()).toEqual([e.carta.cocinaId, e.carta.barraId].sort());
  });

  it('muestra la impresora elegida con su nombre, solo en la sucursal donde se eligió', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const i = await impresoraCreada(ctx, token, e.e.A.S1, cuerpoRed());
    exigirEstado(
      await poner(e.e.A.S1, e.carta.cocinaId, { destino: 'IMPRESORA', impresoraId: i.id }, token),
      200,
      'poner',
    );
    const deS1 = (await destinos(e.e.A.S1, token)).body as Record<string, unknown>[];
    expect(deS1.find((f) => f.estacionId === e.carta.cocinaId)).toMatchObject({
      destino: 'IMPRESORA',
      impresora: { id: i.id, nombre: i.nombre },
    });
    expect(deS1.find((f) => f.estacionId === e.carta.barraId)).toMatchObject({ destino: 'KDS' });
    const deS2 = (await destinos(e.e.A.S2, token)).body as Record<string, unknown>[];
    expect(deS2.every((f) => f.destino === 'KDS' && f.impresora === null)).toBe(true);
  });

  it('una sucursal de B o inexistente es 404 con el mismo cuerpo', async () => {
    const inexistente = await destinos(randomUUID());
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    const deB = await destinos(B().S1);
    expect(deB.status).toBe(404);
    expect(deB.body).toEqual(inexistente.body);
  });
});

describe('criterio 100 · configurar el destino', () => {
  it('IMPRESORA guarda la fila, responde 200 con la fila de la estación y audita el antes y el después', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const antes = (await auditoriaDe(admin, e.e.A.empresaId, 'configurar_destino_estacion')).length;
    const res = await poner(
      S1,
      e.carta.cocinaId,
      { destino: 'IMPRESORA', impresoraId: i.id },
      token,
    );
    exigirEstado(res, 200, 'poner');
    expect(estacionDestinoRespuestaSchema.parse(res.body)).toEqual({
      estacionId: e.carta.cocinaId,
      nombre: expect.any(String),
      destino: 'IMPRESORA',
      impresora: { id: i.id, nombre: i.nombre },
    });
    expect(await filasDestino(S1, e.carta.cocinaId)).toEqual([
      expect.objectContaining({
        empresa_id: e.e.A.empresaId,
        destino: 'IMPRESORA',
        impresora_id: i.id,
        creado_por_usuario_id: e.e.A.base.admin.id,
      }),
    ]);
    const filas = await auditoriaDe(admin, e.e.A.empresaId, 'configurar_destino_estacion');
    expect(filas).toHaveLength(antes + 1);
    expect(filas.at(-1)).toMatchObject({
      sucursal_id: S1,
      actor_usuario_id: e.e.A.base.admin.id,
      entidad: 'estacion_destino',
    });
    expect(filas.at(-1)!.detalle).toEqual({
      sucursalId: S1,
      estacionId: e.carta.cocinaId,
      antes: { destino: 'KDS', impresoraId: null },
      despues: { destino: 'IMPRESORA', impresoraId: i.id },
    });
  });

  it('repetirlo no cambia nada ni audita', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const cuerpo = { destino: 'IMPRESORA', impresoraId: i.id };
    exigirEstado(await poner(S1, e.carta.cocinaId, cuerpo, token), 200, 'primera');
    const fila = await filasDestino(S1, e.carta.cocinaId);
    const auditoria = await totalAuditoria(admin, e.e.A.empresaId);
    const repetida = await poner(S1, e.carta.cocinaId, cuerpo, token);
    exigirEstado(repetida, 200, 'repetida');
    expect(await filasDestino(S1, e.carta.cocinaId)).toEqual(fila);
    expect(await totalAuditoria(admin, e.e.A.empresaId)).toBe(auditoria);
  });

  it('KDS en una estación sin fila no crea nada ni audita; volver a KDS deja la fila en KDS y audita', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const auditoria = await totalAuditoria(admin, e.e.A.empresaId);
    exigirEstado(await poner(S1, e.carta.barraId, { destino: 'KDS' }, token), 200, 'KDS sin fila');
    expect(await filasDestino(S1, e.carta.barraId)).toEqual([]);
    expect(await totalAuditoria(admin, e.e.A.empresaId)).toBe(auditoria);

    const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
    exigirEstado(
      await poner(S1, e.carta.barraId, { destino: 'IMPRESORA', impresoraId: i.id }, token),
      200,
      'a impresora',
    );
    const vuelta = await poner(S1, e.carta.barraId, { destino: 'KDS' }, token);
    exigirEstado(vuelta, 200, 'a KDS');
    expect(vuelta.body).toMatchObject({ destino: 'KDS', impresora: null });
    expect(await filasDestino(S1, e.carta.barraId)).toEqual([
      expect.objectContaining({ destino: 'KDS', impresora_id: null }),
    ]);
    const filas = await auditoriaDe(admin, e.e.A.empresaId, 'configurar_destino_estacion');
    expect(filas.at(-1)!.detalle).toMatchObject({
      antes: { destino: 'IMPRESORA', impresoraId: i.id },
      despues: { destino: 'KDS', impresoraId: null },
    });
    // Y otra vez a la impresora reusa la misma fila (una por estación y sucursal).
    exigirEstado(
      await poner(S1, e.carta.barraId, { destino: 'IMPRESORA', impresoraId: i.id }, token),
      200,
      'de nuevo a impresora',
    );
    expect(await filasDestino(S1, e.carta.barraId)).toHaveLength(1);
  });

  it('cambiar de impresora actualiza la misma fila; cada sucursal tiene su destino', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const uno = await impresoraCreada(ctx, token, e.e.A.S1, cuerpoRed());
    const dos = await impresoraCreada(ctx, token, e.e.A.S1, cuerpoRed());
    const deS2 = await impresoraCreada(ctx, token, e.e.A.S2, cuerpoRed());
    for (const [sucursal, id] of [
      [e.e.A.S1, uno.id],
      [e.e.A.S1, dos.id],
      [e.e.A.S2, deS2.id],
    ] as const) {
      exigirEstado(
        await poner(sucursal, e.carta.cocinaId, { destino: 'IMPRESORA', impresoraId: id }, token),
        200,
        'poner',
      );
    }
    expect(await filasDestino(e.e.A.S1, e.carta.cocinaId)).toEqual([
      expect.objectContaining({ impresora_id: dos.id }),
    ]);
    expect(await filasDestino(e.e.A.S2, e.carta.cocinaId)).toEqual([
      expect.objectContaining({ impresora_id: deS2.id }),
    ]);
  });

  it('una estación inactiva, de B o inexistente es 404 con el mismo cuerpo, y no guarda nada', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const inactiva = await estacionNueva(token, 'Inactiva');
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `/carta/estaciones/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    const cuerpo = { destino: 'IMPRESORA', impresoraId: i.id };
    const inexistente = await poner(S1, randomUUID(), cuerpo, token);
    esperarError(inexistente, 404, 'NO_ENCONTRADO');
    for (const estacionId of [inactiva.id, e.cartaB.cocinaId]) {
      const res = await poner(S1, estacionId, cuerpo, token);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(inexistente.body);
      expect(await filasDestino(S1, estacionId)).toEqual([]);
    }
    // Una sucursal de B o inexistente en la ruta: 404 también.
    esperarError(
      await poner(randomUUID(), e.carta.cocinaId, { destino: 'KDS' }, token),
      404,
      'NO_ENCONTRADO',
    );
    expect((await poner(e.e.B.S1, e.carta.cocinaId, { destino: 'KDS' }, token)).status).toBe(404);
  });

  it('una impresora de otra sucursal, de B, inactiva o inexistente es 422 REFERENCIA_INVALIDA con el mismo cuerpo', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const deS2 = await impresoraCreada(ctx, token, e.e.A.S2, cuerpoRed());
    const deB = await impresoraCreada(ctx, e.token.adminS1B, e.e.B.S1, cuerpoRed());
    const inactiva = await impresoraCreada(ctx, token, S1, cuerpoRed());
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `${rutaImpresoras(S1)}/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    const pedir = (impresoraId: string) =>
      poner(S1, e.carta.cocinaId, { destino: 'IMPRESORA', impresoraId }, token);
    const inexistente = await pedir(randomUUID());
    esperarError(inexistente, 422, 'REFERENCIA_INVALIDA');
    for (const id of [deS2.id, deB.id, inactiva.id]) {
      const res = await pedir(id);
      expect(res.status).toBe(422);
      expect(res.body).toEqual(inexistente.body);
    }
    expect(await filasDestino(S1, e.carta.cocinaId)).toEqual([]);
  });

  it('valida el cuerpo: IMPRESORA exige impresoraId, KDS no lo admite, y no hay otros campos', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const i = await impresoraCreada(ctx, token, e.e.A.S1, cuerpoRed());
    for (const cuerpo of [
      {},
      { destino: 'IMPRESORA' },
      { destino: 'KDS', impresoraId: i.id },
      { destino: 'PANTALLA' },
      { destino: 'IMPRESORA', impresoraId: 'no-es-uuid' },
      { destino: 'IMPRESORA', impresoraId: i.id, sucursalId: e.e.A.S1 },
      { destino: 'IMPRESORA', impresoraId: null },
    ]) {
      const res = await poner(e.e.A.S1, e.carta.cocinaId, cuerpo, token);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
      expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    }
    esperarError(
      await llamar(ctx, token, {
        metodo: 'put',
        ruta: rutaDestino(e.e.A.S1, 'no-es-uuid'),
        cuerpo: { destino: 'KDS' },
      }),
      400,
      'DATOS_INVALIDOS',
    );
  });

  it('dos peticiones a la vez para la misma estación dejan una sola fila', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const uno = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const dos = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const respuestas = await Promise.all(
      [uno.id, dos.id, uno.id, dos.id, uno.id].map((id) =>
        poner(S1, e.carta.cocinaId, { destino: 'IMPRESORA', impresoraId: id }, token),
      ),
    );
    for (const r of respuestas) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const filas = await filasDestino(S1, e.carta.cocinaId);
    expect(filas).toHaveLength(1);
    const auditoria = await auditoriaDe(admin, e.e.A.empresaId, 'configurar_destino_estacion');
    // Cada cambio real deja una fila; la última coincide con lo guardado.
    expect(auditoria.at(-1)!.detalle).toMatchObject({
      despues: { destino: 'IMPRESORA', impresoraId: filas[0]!.impresora_id },
    });
  });
});

describe('criterio 102 · impresora de caja', () => {
  it('sin configurar es null; elegir una impresora activa de la sucursal la guarda y audita', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const vacia = await verCaja(S1, token);
    exigirEstado(vacia, 200, 'GET sin configurar');
    expect(impresionSucursalRespuestaSchema.parse(vacia.body)).toEqual({ impresoraCajaId: null });

    const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const res = await ponerCaja(S1, { impresoraCajaId: i.id }, token);
    exigirEstado(res, 200, 'PUT');
    expect(res.body).toEqual({ impresoraCajaId: i.id });
    expect((await verCaja(S1, token)).body).toEqual({ impresoraCajaId: i.id });
    expect((await verCaja(e.e.A.S2, token)).body).toEqual({ impresoraCajaId: null });

    const filas = await auditoriaDe(admin, e.e.A.empresaId, 'configurar_impresion_sucursal');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      sucursal_id: S1,
      actor_usuario_id: e.e.A.base.admin.id,
      entidad: 'impresion_sucursal',
    });
    expect(filas[0]!.detalle).toEqual({
      sucursalId: S1,
      impresoraCajaId: { antes: null, despues: i.id },
    });
  });

  it('repetirla no audita; cambiarla y quitarla (null) sí; quitarla sin fila no crea nada', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const uno = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const dos = await impresoraCreada(ctx, token, S1, cuerpoRed());
    const filasCaja = async () =>
      (await admin.query('SELECT * FROM impresion_sucursal WHERE sucursal_id = $1', [S1])).rows;

    exigirEstado(await ponerCaja(S1, { impresoraCajaId: null }, token), 200, 'null sin fila');
    expect(await filasCaja()).toEqual([]);
    expect(await auditoriaDe(admin, e.e.A.empresaId, 'configurar_impresion_sucursal')).toHaveLength(
      0,
    );

    exigirEstado(await ponerCaja(S1, { impresoraCajaId: uno.id }, token), 200, 'uno');
    exigirEstado(await ponerCaja(S1, { impresoraCajaId: uno.id }, token), 200, 'repetida');
    expect(await auditoriaDe(admin, e.e.A.empresaId, 'configurar_impresion_sucursal')).toHaveLength(
      1,
    );

    exigirEstado(await ponerCaja(S1, { impresoraCajaId: dos.id }, token), 200, 'dos');
    exigirEstado(await ponerCaja(S1, { impresoraCajaId: null }, token), 200, 'quitarla');
    expect((await verCaja(S1, token)).body).toEqual({ impresoraCajaId: null });
    const filas = await auditoriaDe(admin, e.e.A.empresaId, 'configurar_impresion_sucursal');
    expect(filas.map((f) => f.detalle)).toEqual([
      { sucursalId: S1, impresoraCajaId: { antes: null, despues: uno.id } },
      { sucursalId: S1, impresoraCajaId: { antes: uno.id, despues: dos.id } },
      { sucursalId: S1, impresoraCajaId: { antes: dos.id, despues: null } },
    ]);
    // Una sola fila por sucursal.
    expect(await filasCaja()).toHaveLength(1);
  });

  it('una impresora de otra sucursal, de B, inactiva o inexistente es 422; la sucursal ajena es 404', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const deS2 = await impresoraCreada(ctx, token, e.e.A.S2, cuerpoRed());
    const deB = await impresoraCreada(ctx, e.token.adminS1B, e.e.B.S1, cuerpoRed());
    const inactiva = await impresoraCreada(ctx, token, S1, cuerpoRed());
    exigirEstado(
      await llamar(ctx, token, {
        metodo: 'patch',
        ruta: `${rutaImpresoras(S1)}/${inactiva.id}`,
        cuerpo: { activa: false },
      }),
      200,
      'desactivar',
    );
    const inexistente = await ponerCaja(S1, { impresoraCajaId: randomUUID() }, token);
    esperarError(inexistente, 422, 'REFERENCIA_INVALIDA');
    for (const id of [deS2.id, deB.id, inactiva.id]) {
      const res = await ponerCaja(S1, { impresoraCajaId: id }, token);
      expect(res.status).toBe(422);
      expect(res.body).toEqual(inexistente.body);
    }
    expect((await verCaja(S1, token)).body).toEqual({ impresoraCajaId: null });
    expect(await auditoriaDe(admin, e.e.A.empresaId, 'configurar_impresion_sucursal')).toHaveLength(
      0,
    );

    const ajena = await ponerCaja(e.e.B.S1, { impresoraCajaId: null }, token);
    const sinSucursal = await ponerCaja(randomUUID(), { impresoraCajaId: null }, token);
    esperarError(sinSucursal, 404, 'NO_ENCONTRADO');
    expect(ajena.status).toBe(404);
    expect(ajena.body).toEqual(sinSucursal.body);
    expect((await verCaja(e.e.B.S1, token)).status).toBe(404);
  });

  it('valida el cuerpo: impresoraCajaId es obligatorio, un UUID o null, y no hay otros campos', async () => {
    for (const cuerpo of [
      {},
      { impresoraCajaId: 'x' },
      { impresoraCajaId: 5 },
      { impresoraCajaId: null, otro: 1 },
    ]) {
      const res = await ponerCaja(A().S1, cuerpo);
      expect(res.status, JSON.stringify(cuerpo)).toBe(400);
    }
  });
});

describe('IMPRESION.destinos · el ruteo de las comandas y el KDS (criterio 61 en 3b)', () => {
  /** Cocina (lomo) a una impresora, Barra (gaseosa) sin configurar; envía y devuelve las comandas. */
  async function enviarConCocinaEnImpresora() {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const S1 = e.e.A.S1;
    const i = await impresoraCreada(ctx, token, S1, cuerpoRed());
    exigirEstado(
      await poner(S1, e.carta.cocinaId, { destino: 'IMPRESORA', impresoraId: i.id }, token),
      200,
      'Cocina a la impresora',
    );
    return { e, i, token, S1, L: lineasDe(e.carta) };
  }

  it('el puerto devuelve KDS para lo que no tiene fila e IMPRESORA con su impresora para lo configurado', async () => {
    const { e, i, S1, L: lineas } = await enviarConCocinaEnImpresora();
    const puerto = ctx.app.get<ImpresionPuerto>(IMPRESION, { strict: false });
    const original = puerto.destinos.bind(puerto);
    const vistos: ReadonlyMap<string, unknown>[] = [];
    puerto.destinos = async (sucursalId, estacionIds) => {
      const r = await original(sucursalId, estacionIds);
      vistos.push(r);
      return r;
    };
    try {
      const orden = await abrirOrden(ctx, e.salon, e.token.mozo);
      await enviarOk(ctx, e.token.mozo, orden.id, [lineas.lomo(['3/4'], 1), lineas.gaseosa(1)]);
    } finally {
      puerto.destinos = original;
    }
    expect(vistos).toHaveLength(1);
    expect(Object.fromEntries(vistos[0]!)).toEqual({
      [e.carta.cocinaId]: { destino: 'IMPRESORA', impresoraId: i.id },
      [e.carta.barraId]: { destino: 'KDS' },
    });
    expect(S1).toBe(e.e.A.S1);
  });

  it('el envío no falla: la comanda de la estación con impresora queda IMPRESORA y la otra KDS', async () => {
    const { e, L: lineas } = await enviarConCocinaEnImpresora();
    const orden = await abrirOrden(ctx, e.salon, e.token.mozo);
    const envio = await enviarOk(ctx, e.token.mozo, orden.id, [
      lineas.lomo(['3/4'], 1),
      lineas.gaseosa(1),
    ]);
    expect(envio.comandas.map((c) => [c.estacionNombre, c.destino]).sort()).toEqual([
      ['Barra', 'KDS'],
      ['Cocina', 'IMPRESORA'],
    ]);
    const { rows } = await admin.query(
      'SELECT estacion_id, destino FROM comanda WHERE orden_id = $1 ORDER BY destino',
      [orden.id],
    );
    expect(rows).toEqual([
      { estacion_id: e.carta.cocinaId, destino: 'IMPRESORA' },
      { estacion_id: e.carta.barraId, destino: 'KDS' },
    ]);
  });

  it('el KDS solo muestra las comandas con destino KDS y la de la impresora no se opera desde él', async () => {
    const { e, L: lineas } = await enviarConCocinaEnImpresora();
    const orden = await abrirOrden(ctx, e.salon, e.token.mozo);
    await enviarOk(ctx, e.token.mozo, orden.id, [lineas.lomo(['3/4'], 1), lineas.gaseosa(1)]);
    const kds = await llamar(ctx, e.token.cocina, { metodo: 'get', ruta: '/cocina/comandas' });
    exigirEstado(kds, 200, 'KDS');
    const propias = cocinaRespuestaSchema
      .parse(kds.body)
      .pendientes.filter((c) => c.orden.id === orden.id);
    expect(propias.map((c) => c.estacion.id)).toEqual([e.carta.barraId]);
    const deImpresora = (
      await admin.query(
        `SELECT cl.id FROM comanda_linea cl JOIN comanda c ON c.id = cl.comanda_id
          WHERE c.orden_id = $1 AND c.destino = 'IMPRESORA'`,
        [orden.id],
      )
    ).rows[0].id as string;
    esperarError(
      await llamar(ctx, e.token.cocina, {
        metodo: 'put',
        ruta: `/cocina/lineas/${deImpresora}/estado`,
        cuerpo: { estado: 'LISTO' },
      }),
      404,
      'NO_ENCONTRADO',
    );
  });

  it('las comandas ya creadas conservan su destino cuando la configuración cambia después', async () => {
    const { e, S1, token, L: lineas } = await enviarConCocinaEnImpresora();
    const primera = await abrirOrden(ctx, e.salon, e.token.mozo);
    await enviarOk(ctx, e.token.mozo, primera.id, [lineas.lomo(['3/4'], 1)]);
    // Cocina vuelve al KDS y Barra pasa a la impresora.
    const barra = await impresoraCreada(ctx, token, S1, cuerpoRed());
    exigirEstado(await poner(S1, e.carta.cocinaId, { destino: 'KDS' }, token), 200, 'Cocina a KDS');
    exigirEstado(
      await poner(S1, e.carta.barraId, { destino: 'IMPRESORA', impresoraId: barra.id }, token),
      200,
      'Barra a impresora',
    );
    const segunda = await abrirOrden(ctx, e.salon, e.token.mozo);
    await enviarOk(ctx, e.token.mozo, segunda.id, [lineas.lomo(['3/4'], 1), lineas.gaseosa(1)]);
    // Una adición a la primera orden sale por el destino de ahora (Cocina: KDS).
    await enviarOk(ctx, e.token.mozo, primera.id, [lineas.lomo(['3/4'], 1)]);

    const destinoDe = async (ordenId: string) =>
      (
        await admin.query(
          `SELECT c.estacion_id, c.tipo, c.destino FROM comanda c WHERE c.orden_id = $1
            ORDER BY c.creado_en, c.tipo`,
          [ordenId],
        )
      ).rows;
    expect(await destinoDe(primera.id)).toEqual([
      { estacion_id: e.carta.cocinaId, tipo: 'COMANDA', destino: 'IMPRESORA' },
      { estacion_id: e.carta.cocinaId, tipo: 'ADICION', destino: 'KDS' },
    ]);
    expect((await destinoDe(segunda.id)).map((c) => [c.estacion_id, c.destino]).sort()).toEqual(
      [
        [e.carta.cocinaId, 'KDS'],
        [e.carta.barraId, 'IMPRESORA'],
      ].sort(),
    );
  });

  it('un destino de otra sucursal no afecta a esta: S2 sigue enviando al KDS', async () => {
    const e = await prepararEscenarioP2(ctx);
    const token = e.token.adminA;
    const deS1 = await impresoraCreada(ctx, token, e.e.A.S1, cuerpoRed());
    exigirEstado(
      await poner(
        e.e.A.S1,
        e.carta.cocinaId,
        { destino: 'IMPRESORA', impresoraId: deS1.id },
        token,
      ),
      200,
      'Cocina de S1',
    );
    const orden = await abrirOrden(ctx, e.salonS2, e.token.mozoS2);
    const envio = await enviarOk(ctx, e.token.mozoS2, orden.id, [lineasDe(e.carta).gaseosa(1)]);
    expect(envio.comandas.map((c) => c.destino)).toEqual(['KDS']);
  });

  it('IMPRESION.encolar acepta trabajos mientras no exista la cola (T40) y no lanza', async () => {
    const puerto = ctx.app.get<ImpresionPuerto>(IMPRESION, { strict: false });
    await expect(
      puerto.encolar([
        {
          sucursalId: A().S1,
          impresoraId: randomUUID(),
          tipo: 'COMANDA',
          comandaId: randomUUID(),
          precuentaId: null,
          documento: {},
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
