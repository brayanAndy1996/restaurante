// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 32 y contrato de `OperacionPlataforma` (falla F2 del adversarial): "o quedan el cambio y su
// auditoría, o no queda nada". Si el código de `fn` confirma o revierte la transacción por su cuenta
// (o escribe fuera de ella), la operación no puede dejar un cambio confirmado sin su fila de
// auditoría. Solo se aceptan dos resultados: (a) `ejecutar` rechaza y no hay cambio ni auditoría, o
// (b) hay cambio Y auditoría. Nunca cambio sin auditoría ni auditoría sin cambio.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { OperacionPlataforma, PlataformaEmpresasService } from '../../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { datosDeEmpresa, textoUnico } from './fabrica';

let app: INestApplication;
let operacion: OperacionPlataforma;
let admin: Client;
let empresaId: string;
let nombreOriginal: string;

beforeAll(async () => {
  fijarEntornoDePrueba();
  app = await crearAplicacion();
  operacion = app.get(OperacionPlataforma);
  admin = await abrirCliente('admin');
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

/** Cada prueba trabaja con su propia empresa para no pisarse con las demás. */
async function nuevaEmpresa(): Promise<void> {
  const datos = datosDeEmpresa();
  const resultado = await app
    .get(PlataformaEmpresasService)
    .registrarEmpresa(datos, { actor: textoUnico('actor-alta'), motivo: 'Alta para atomicidad' });
  empresaId = resultado.empresaId;
  nombreOriginal = datos.nombre;
}

const sequelizeDe = (tx: unknown) => (tx as { sequelize: Sequelize }).sequelize;

async function nombreActual(): Promise<string> {
  const { rows } = await admin.query<{ nombre: string }>(
    'SELECT nombre FROM empresa WHERE id = $1',
    [empresaId],
  );
  return rows[0]!.nombre;
}

async function auditorias(actor: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM auditoria WHERE origen = 'plataforma' AND actor_sistema = $1",
    [actor],
  );
  return Number(rows[0]!.n);
}

/** Verifica que el estado final sea uno de los dos aceptables y no deje un cambio sin su auditoría. */
async function exigirAtomicidad(actor: string, nombreNuevo: string, rechazo: unknown) {
  const nombre = await nombreActual();
  const cantidad = await auditorias(actor);
  const hayCambio = nombre === nombreNuevo;
  const estado = JSON.stringify({ hayCambio, auditorias: cantidad, rechazo: String(rechazo) });
  // Nunca un cambio confirmado sin su fila de auditoría.
  expect(hayCambio && cantidad === 0, `cambio confirmado sin auditoría: ${estado}`).toBe(false);
  // Tampoco una auditoría sin el cambio que la justifica.
  expect(!hayCambio && cantidad > 0, `auditoría sin cambio: ${estado}`).toBe(false);
  if (!hayCambio) {
    expect(nombre).toBe(nombreOriginal);
    expect(rechazo, 'si no queda nada, ejecutar debe rechazar').toBeDefined();
  }
}

async function capturar(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error ?? new Error('rechazo sin error');
  }
  return undefined;
}

describe('criterio 32 · OperacionPlataforma.ejecutar es atómica con su auditoría', () => {
  it('fn que hace UPDATE y confirma por su cuenta (tx.commit): no queda cambio sin auditoría', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-commit');
    const nombreNuevo = textoUnico('Cambiado-commit');
    const rechazo = await capturar(
      operacion.ejecutar(
        { actor, motivo: 'Prueba de commit manual', operacion: 'prueba_commit' },
        async (tx) => {
          await sequelizeDe(tx).query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
            transaction: tx,
            replacements: { nombre: nombreNuevo, id: empresaId },
          });
          await tx.commit();
        },
      ),
    );
    await exigirAtomicidad(actor, nombreNuevo, rechazo);
  });

  it('fn que revierte (tx.rollback) y luego hace otro UPDATE fuera de la transacción: no queda cambio sin auditoría', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-rollback');
    const nombreNuevo = textoUnico('Cambiado-rollback');
    const rechazo = await capturar(
      operacion.ejecutar(
        { actor, motivo: 'Prueba de rollback manual', operacion: 'prueba_rollback' },
        async (tx) => {
          const sequelize = sequelizeDe(tx);
          await tx.rollback();
          await sequelize.query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
            replacements: { nombre: nombreNuevo, id: empresaId },
          });
        },
      ),
    );
    await exigirAtomicidad(actor, nombreNuevo, rechazo);
  });

  it('fn que confirma con tx.commit() sin cambiar nada: no queda auditoría fantasma ni error silencioso', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-commit-vacio');
    const rechazo = await capturar(
      operacion.ejecutar(
        { actor, motivo: 'Prueba de commit vacío', operacion: 'prueba_commit_vacio' },
        async (tx) => {
          await tx.commit();
        },
      ),
    );
    // Sin cambio alguno: o rechaza (y no hay auditoría) o termina bien con su auditoría, pero nunca
    // termina sin error y sin auditoría.
    const cantidad = await auditorias(actor);
    if (rechazo === undefined) expect(cantidad).toBe(1);
    else expect(cantidad).toBe(0);
  });
});

describe('contrato · OperacionPlataforma.consultar (lectura sin auditoría) no deja cambios confirmados', () => {
  it('fn que hace UPDATE y confirma con tx.commit() dentro de consultar: el cambio no queda', async () => {
    await nuevaEmpresa();
    const nombreNuevo = textoUnico('Cambiado-consultar');
    const rechazo = await capturar(
      operacion.consultar(async (tx) => {
        await sequelizeDe(tx).query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          transaction: tx,
          replacements: { nombre: nombreNuevo, id: empresaId },
        });
        await tx.commit();
      }),
    );
    // consultar nunca audita, así que ninguna vía debe dejar un cambio confirmado.
    expect(
      await nombreActual(),
      `consultar dejó un cambio confirmado sin auditoría (${String(rechazo)})`,
    ).toBe(nombreOriginal);
  });

  it('fn que revierte y luego escribe fuera de la transacción dentro de consultar: el cambio no queda', async () => {
    await nuevaEmpresa();
    const nombreNuevo = textoUnico('Cambiado-consultar-fuera');
    const rechazo = await capturar(
      operacion.consultar(async (tx) => {
        const sequelize = sequelizeDe(tx);
        await tx.rollback();
        await sequelize.query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          replacements: { nombre: nombreNuevo, id: empresaId },
        });
      }),
    );
    expect(
      await nombreActual(),
      `consultar dejó un cambio confirmado sin auditoría (${String(rechazo)})`,
    ).toBe(nombreOriginal);
  });
});
