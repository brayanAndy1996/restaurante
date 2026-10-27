// Criterio 32b (pruebas del desarrollador, complementan las protegidas de aislamiento/): `fn` no puede
// cerrar la transacción de plataforma por ninguna vía, y `consultar` es de solo lectura.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import type { Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { contieneControlDeTransaccion } from '../src/nucleo/base-de-datos/control-transaccion';
import { OperacionPlataforma, PlataformaEmpresasService } from '../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from './utilidades';
import { datosDeEmpresa, textoUnico } from './aislamiento/fabrica';

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
  // Sequelize avisa por consola cuando destruye la conexión de una transacción cerrada a la fuerza.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app?.close();
  await admin?.end();
});

async function nuevaEmpresa(): Promise<void> {
  const datos = datosDeEmpresa();
  const resultado = await app
    .get(PlataformaEmpresasService)
    .registrarEmpresa(datos, { actor: textoUnico('actor-alta'), motivo: 'Alta para cierre' });
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
    'SELECT count(*)::text AS n FROM auditoria_plataforma WHERE actor = $1',
    [actor],
  );
  return Number(rows[0]!.n);
}

const CIERRES_SQL = [
  'COMMIT',
  'commit;',
  'ROLLBACK',
  'END',
  'ABORT',
  'COMMIT AND CHAIN',
  'SAVEPOINT a',
  'RELEASE SAVEPOINT a',
  'ROLLBACK TO SAVEPOINT a',
  'BEGIN',
  'START TRANSACTION',
  'SET TRANSACTION READ WRITE',
  'SET standard_conforming_strings = off',
  '/* hola */ COMMIT',
  '-- hola\nCOMMIT',
  'SELECT 1; COMMIT',
  "UPDATE empresa SET nombre = 'x'; END",
  "SELECT '; ' ; COMMIT",
  "PREPARE TRANSACTION 't'",
];

describe('criterio 32b · fn no puede cerrar la transacción de plataforma', () => {
  it.each(CIERRES_SQL)('ejecutar: SQL «%s» falla y no queda cambio ni auditoría', async (sql) => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-sql');
    const nombreNuevo = textoUnico('Cambiado-sql');
    await expect(
      operacion.ejecutar(
        { actor, motivo: 'Prueba de SQL de cierre', operacion: 'prueba_sql' },
        async (tx) => {
          const sequelize = sequelizeDe(tx);
          await sequelize.query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
            transaction: tx,
            replacements: { nombre: nombreNuevo, id: empresaId },
          });
          await sequelize.query(sql, { transaction: tx });
        },
      ),
    ).rejects.toThrow();
    expect(await nombreActual()).toBe(nombreOriginal);
    expect(await auditorias(actor)).toBe(0);
  });

  it('ejecutar: tx.commit() falla y no queda nada', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-commit');
    await expect(
      operacion.ejecutar({ actor, motivo: 'Commit manual', operacion: 'prueba' }, async (tx) => {
        await sequelizeDe(tx).query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          transaction: tx,
          replacements: { nombre: textoUnico('X'), id: empresaId },
        });
        await tx.commit();
      }),
    ).rejects.toThrow();
    expect(await nombreActual()).toBe(nombreOriginal);
    expect(await auditorias(actor)).toBe(0);
  });

  it('ejecutar: si fn traga el error de commit(), la operación igual falla y no queda nada', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-tragado');
    await expect(
      operacion.ejecutar({ actor, motivo: 'Commit tragado', operacion: 'prueba' }, async (tx) => {
        await sequelizeDe(tx).query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          transaction: tx,
          replacements: { nombre: textoUnico('X'), id: empresaId },
        });
        await tx.commit().catch(() => undefined);
      }),
    ).rejects.toThrow();
    expect(await nombreActual()).toBe(nombreOriginal);
    expect(await auditorias(actor)).toBe(0);
  });

  it('ejecutar: tx.rollback() falla y no queda nada', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-rollback');
    await expect(
      operacion.ejecutar({ actor, motivo: 'Rollback manual', operacion: 'prueba' }, async (tx) => {
        await tx.rollback();
      }),
    ).rejects.toThrow();
    expect(await auditorias(actor)).toBe(0);
  });

  it('ejecutar: un valor «COMMIT» o «END» en los datos no es una sentencia de cierre', async () => {
    await nuevaEmpresa();
    const actor = textoUnico('actor-valor');
    await operacion.ejecutar({ actor, motivo: 'Valores', operacion: 'prueba' }, async (tx) => {
      await sequelizeDe(tx).query("UPDATE empresa SET nombre = 'COMMIT; END' WHERE id = :id", {
        transaction: tx,
        replacements: { id: empresaId },
      });
    });
    expect(await nombreActual()).toBe('COMMIT; END');
    expect(await auditorias(actor)).toBe(1);
  });

  it('consultar: tx.commit() falla y el UPDATE no queda', async () => {
    await nuevaEmpresa();
    await expect(
      operacion.consultar(async (tx) => {
        await sequelizeDe(tx).query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          transaction: tx,
          replacements: { nombre: textoUnico('X'), id: empresaId },
        });
        await tx.commit();
      }),
    ).rejects.toThrow();
    expect(await nombreActual()).toBe(nombreOriginal);
  });

  it('consultar: es de solo lectura (un UPDATE falla aunque no se confirme)', async () => {
    await nuevaEmpresa();
    await expect(
      operacion.consultar(async (tx) => {
        await sequelizeDe(tx).query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          transaction: tx,
          replacements: { nombre: textoUnico('X'), id: empresaId },
        });
      }),
    ).rejects.toThrow(/read-only|solo lectura/i);
    expect(await nombreActual()).toBe(nombreOriginal);
  });

  it('consultar: una lectura normal sigue funcionando', async () => {
    await nuevaEmpresa();
    const filas = await operacion.consultar(async (tx) => {
      const [resultado] = await sequelizeDe(tx).query('SELECT nombre FROM empresa WHERE id = :id', {
        transaction: tx,
        replacements: { id: empresaId },
      });
      return resultado as { nombre: string }[];
    });
    expect(filas[0]?.nombre).toBe(nombreOriginal);
  });
});

describe('control-transaccion · detección de sentencias de cierre', () => {
  it.each([
    ['COMMIT', true],
    ['  rollback ;', true],
    ['(COMMIT)', true],
    ['SELECT 1; END', true],
    ['SELECT 1 /* ; COMMIT */', false],
    ["SELECT 'COMMIT'", false],
    ["UPDATE t SET a = E'\\'; COMMIT'", false],
    ["UPDATE t SET a = 'a\\'; COMMIT", true],
    ['SELECT $x$ ; COMMIT $x$', false],
    ['SELECT $1, $2', false],
    ['SELECT "commit" FROM t', false],
    ["SELECT 'sin cerrar", true],
    ['/* sin cerrar', true],
    ['INSERT INTO t (a) VALUES ($1) RETURNING id', false],
    ['SELECT CASE WHEN a THEN 1 END FROM t', false],
  ] as const)('%s -> %s', (sql, esperado) => {
    expect(contieneControlDeTransaccion(sql)).toBe(esperado);
  });
});
