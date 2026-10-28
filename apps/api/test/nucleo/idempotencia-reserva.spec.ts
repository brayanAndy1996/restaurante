// Pruebas del desarrollador (no protegidas) de I-3: `reservarClave`, `completarClave` y `liberarClave`, la
// única implementación de la reserva de claves de idempotencia que usan `IdempotenciaInterceptor` y la clave
// de supervisor. Corren dentro de `ContextoEmpresa.ejecutar` contra PostgreSQL real.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import {
  RETENCION_IDEMPOTENCIA_MS,
  completarClave,
  liberarClave,
  reservarClave,
  type PeticionIdempotente,
  type ReservaClave,
} from '../../src/nucleo/idempotencia';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, type EmpresaSql } from '../aislamiento/fabrica';

let app: INestApplication;
let contexto: ContextoEmpresa;
let conexion: Sequelize;
let plataforma: Client;
let admin: Client;
let A: EmpresaSql;
let B: EmpresaSql;

const T0 = new Date('2026-11-02T10:00:00-05:00');

beforeAll(async () => {
  fijarEntornoDePrueba({ empresaPorHeader: false, poolMax: 2 });
  app = await crearAplicacion({ logger: false });
  contexto = app.get(ContextoEmpresa);
  conexion = app.get<Sequelize>(CONEXION_API);
  plataforma = await abrirCliente('plataforma');
  admin = await abrirCliente('admin');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  for (const c of [plataforma, admin]) await c?.end();
});

/** Petición idempotente de la empresa dada, con una clave nueva salvo que se indique. */
const peticion = (
  empresa: EmpresaSql,
  parcial: Partial<PeticionIdempotente> = {},
): PeticionIdempotente => ({
  empresaId: empresa.id,
  clave: randomUUID(),
  ruta: 'POST /cosas/1',
  actor: 'usuario:u1',
  huella: 'huella-1',
  ahora: T0,
  ...parcial,
});

/** Reserva en su propia transacción (se confirma al terminar). */
const reservar = (empresa: EmpresaSql, p: PeticionIdempotente): Promise<ReservaClave> =>
  contexto.ejecutar(empresa.id, () => reservarClave(conexion, p));

const filas = async (clave: string) =>
  (
    await admin.query<{ estado: string; estado_http: number | null; respuesta: unknown }>(
      'SELECT estado, estado_http, respuesta FROM idempotencia WHERE clave = $1',
      [clave],
    )
  ).rows;

const rechazo = (r: ReservaClave): ErrorAplicacion => {
  expect(r.tipo).toBe('rechazada');
  return (r as Extract<ReservaClave, { tipo: 'rechazada' }>).error;
};

describe('reservarClave / completarClave', () => {
  it('una clave nueva se reserva "en_curso"; al completarla, la misma petición recibe la respuesta guardada', async () => {
    const p = peticion(A);
    await contexto.ejecutar(A.id, async () => {
      expect(await reservarClave(conexion, p)).toEqual({ tipo: 'nueva' });
      await completarClave(conexion, p, 201, { id: 'x', total: '10.50' });
    });
    expect(await filas(p.clave)).toEqual([
      { estado: 'completada', estado_http: 201, respuesta: { id: 'x', total: '10.50' } },
    ]);
    expect(await reservar(A, p)).toEqual({
      tipo: 'completada',
      respuesta: { id: 'x', total: '10.50' },
    });
    expect(await filas(p.clave)).toHaveLength(1); // repetirla no duplica nada
  });

  it('completarClave guarda el estado HTTP que recibe y una respuesta vacía como null', async () => {
    const p = peticion(A);
    await contexto.ejecutar(A.id, async () => {
      await reservarClave(conexion, p);
      await completarClave(conexion, p, 204, undefined);
    });
    expect((await filas(p.clave))[0]).toMatchObject({ estado_http: 204, respuesta: null });
    expect(await reservar(A, p)).toEqual({ tipo: 'completada', respuesta: null });
  });

  it('la misma clave con otra huella, otra ruta u otro actor es 422 CLAVE_IDEMPOTENCIA_REUTILIZADA', async () => {
    const p = peticion(A);
    await contexto.ejecutar(A.id, async () => {
      await reservarClave(conexion, p);
      await completarClave(conexion, p, 201, { ok: true });
    });
    for (const distinta of [
      { huella: 'otra' },
      { ruta: 'POST /cosas/2' },
      { actor: 'usuario:u2' },
    ]) {
      const error = rechazo(await reservar(A, { ...p, ...distinta }));
      expect(error.getStatus()).toBe(422);
      expect(error.codigo).toBe('CLAVE_IDEMPOTENCIA_REUTILIZADA');
    }
    // La respuesta original sigue intacta.
    expect(await reservar(A, p)).toEqual({ tipo: 'completada', respuesta: { ok: true } });
  });

  it('una clave reservada y nunca completada responde 409 CONFLICTO ("sigue en curso") a la misma petición', async () => {
    const p = peticion(A);
    expect(await reservar(A, p)).toEqual({ tipo: 'nueva' }); // se confirma sin completarla
    const error = rechazo(await reservar(A, p));
    expect(error.getStatus()).toBe(409);
    expect(error.codigo).toBe('CONFLICTO');
    // Con otra huella la reutilización se detecta primero.
    expect(rechazo(await reservar(A, { ...p, huella: 'otra' })).codigo).toBe(
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
  });

  it('liberarClave deja la clave libre: la misma petición puede reservarla de nuevo', async () => {
    const p = peticion(A);
    await contexto.ejecutar(A.id, async () => {
      expect(await reservarClave(conexion, p)).toEqual({ tipo: 'nueva' });
      await liberarClave(conexion, p.clave);
    });
    expect(await filas(p.clave)).toEqual([]);
    expect(await reservar(A, p)).toEqual({ tipo: 'nueva' });
  });

  it('si la transacción se revierte, la reserva desaparece con ella', async () => {
    const p = peticion(A);
    await expect(
      contexto.ejecutar(A.id, async () => {
        await reservarClave(conexion, p);
        throw new Error('falla la operación');
      }),
    ).rejects.toThrow('falla la operación');
    expect(await filas(p.clave)).toEqual([]);
    expect(await reservar(A, p)).toEqual({ tipo: 'nueva' });
  });

  it('las claves son por empresa: la misma clave en otra empresa es nueva y no ve la respuesta ajena', async () => {
    const clave = randomUUID();
    const deA = peticion(A, { clave });
    await contexto.ejecutar(A.id, async () => {
      await reservarClave(conexion, deA);
      await completarClave(conexion, deA, 201, { secreto: 'de A' });
    });
    const deB = peticion(B, { clave });
    expect(await reservar(B, deB)).toEqual({ tipo: 'nueva' });
    expect(rechazo(await reservar(A, { ...deA, huella: 'otra' })).codigo).toBe(
      'CLAVE_IDEMPOTENCIA_REUTILIZADA',
    );
    const { rows } = await admin.query<{ empresa_id: string }>(
      'SELECT empresa_id FROM idempotencia WHERE clave = $1 ORDER BY empresa_id',
      [clave],
    );
    expect(rows.map((f) => f.empresa_id).sort()).toEqual([A.id, B.id].sort());
  });

  it('las claves se guardan 24 horas: a las 24 h exactas siguen valiendo y un milisegundo después se borran', async () => {
    const p = peticion(A);
    await contexto.ejecutar(A.id, async () => {
      await reservarClave(conexion, p);
      await completarClave(conexion, p, 201, { ok: 1 });
    });
    const justo = new Date(T0.getTime() + RETENCION_IDEMPOTENCIA_MS);
    expect(await reservar(A, { ...p, ahora: justo })).toEqual({
      tipo: 'completada',
      respuesta: { ok: 1 },
    });
    const vencida = new Date(T0.getTime() + RETENCION_IDEMPOTENCIA_MS + 1);
    expect(await reservar(A, { ...p, ahora: vencida, huella: 'otra huella' })).toEqual({
      tipo: 'nueva',
    });
  });

  it('dos reservas simultáneas de la misma clave: una es nueva y la otra espera y recibe la respuesta completada', async () => {
    const p = peticion(A);
    let soltar!: () => void;
    const puerta = new Promise<void>((resolver) => (soltar = resolver));
    const primera = contexto.ejecutar(A.id, async () => {
      expect(await reservarClave(conexion, p)).toEqual({ tipo: 'nueva' });
      await puerta; // la segunda ya está esperando el INSERT cuando se completa
      await completarClave(conexion, p, 201, { ganadora: true });
    });
    const segunda = reservar(A, p);
    await new Promise((r) => setTimeout(r, 300));
    soltar();
    await primera;
    expect(await segunda).toEqual({ tipo: 'completada', respuesta: { ganadora: true } });
    expect(await filas(p.clave)).toHaveLength(1);
  });
});
