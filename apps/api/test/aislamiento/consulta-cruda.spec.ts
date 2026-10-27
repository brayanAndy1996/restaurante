// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 22 y caso límite "operaciones fuera de HTTP": una consulta cruda por la conexión de la API
// (`CONEXION_API`) fuera de `ContextoEmpresa.ejecutar` lanza `ContextoEmpresaAusenteError` ANTES de
// enviarse a la base; dentro del contexto funciona y la RLS limita las filas a la empresa.
//
// "Antes de enviar la consulta a la base" se demuestra con efectos observables desde el administrador
// (que ve todo el catálogo): un bloqueo asesor (`pg_advisory_lock`, que sobreviviría en la sesión del
// pool si la consulta llegara), el texto de la última consulta de las sesiones de `restaurante_api`
// (`pg_stat_activity`) y un `INSERT` que no deja filas. Las claves y los marcadores son aleatorios, así
// que son robustos aunque otros archivos corran en paralelo contra la misma base.
import type { INestApplication } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Client } from 'pg';
import { QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa, ContextoEmpresaAusenteError } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, textoUnico, type EmpresaSql } from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let admin: Client;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

/** Par de enteros para `pg_advisory_lock(int, int)`; aleatorio para no chocar con otros archivos. */
function claveAsesora(): [number, number] {
  return [randomInt(1, 2_000_000_000), randomInt(1, 2_000_000_000)];
}

/** Cantidad de bloqueos asesores de sesión con esa clave, vistos desde el administrador. */
async function bloqueosAsesores([clase, objeto]: [number, number]): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_locks
      WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid AND granted`,
    [clase, objeto],
  );
  return Number(rows[0]!.n);
}

/** Sesiones de `restaurante_api` cuya última consulta contiene el marcador, vistas desde el administrador. */
async function sesionesConMarcador(marcador: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    `SELECT count(*) AS n FROM pg_stat_activity
      WHERE usename = 'restaurante_api' AND datname = current_database() AND query LIKE $1`,
    [`%${marcador}%`],
  );
  return Number(rows[0]!.n);
}

const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();

describe('criterio 22 · consulta cruda por CONEXION_API fuera de ContextoEmpresa.ejecutar', () => {
  it('CONEXION_API entrega la instancia de Sequelize de la API', () => {
    expect(typeof sequelize.query).toBe('function');
    expect(typeof sequelize.transaction).toBe('function');
  });

  it('un SELECT crudo lanza ContextoEmpresaAusenteError (no un error de la base)', async () => {
    await expect(sequelize.query('SELECT 1 AS uno')).rejects.toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    await expect(
      sequelize.query('SELECT 1 AS uno', { type: QueryTypes.SELECT }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('un SELECT crudo sobre sucursal y sobre empresa lanza ContextoEmpresaAusenteError', async () => {
    await expect(
      sequelize.query('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    await expect(
      sequelize.query('SELECT id FROM empresa', { type: QueryTypes.SELECT }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    await expect(
      sequelize.query('SELECT id FROM sucursal WHERE id = :id', {
        type: QueryTypes.SELECT,
        replacements: { id: A.sucursales[0]!.id },
      }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    await expect(
      sequelize.query('SELECT id FROM emisor WHERE id = $1', {
        type: QueryTypes.SELECT,
        bind: [A.emisores[0]!.id],
      }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('un UPDATE, un DELETE y un INSERT crudos también lanzan ContextoEmpresaAusenteError', async () => {
    await expect(
      sequelize.query('UPDATE sucursal SET direccion = direccion'),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    await expect(
      sequelize.query('DELETE FROM sucursal WHERE id = :id', {
        replacements: { id: A.sucursales[0]!.id },
      }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    await expect(
      sequelize.query(
        `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion)
         VALUES (:empresa, :emisor, :nombre, '0099', 'Calle 1')`,
        {
          replacements: {
            empresa: A.id,
            emisor: A.emisores[0]!.id,
            nombre: textoUnico('Cruda'),
          },
        },
      ),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('la sentencia ni siquiera llega a la base: no queda un bloqueo asesor en ninguna sesión', async () => {
    const clave = claveAsesora();
    await expect(
      sequelize.query(`SELECT pg_advisory_lock(${clave[0]}, ${clave[1]})`),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(await bloqueosAsesores(clave)).toBe(0);

    // Con un pool de 2 conexiones la prueba no depende de cuál sesión atendería la consulta:
    // se repite varias veces y el bloqueo nunca aparece.
    for (let i = 0; i < 4; i++) {
      await expect(
        sequelize.query(`SELECT pg_advisory_lock(${clave[0]}, ${clave[1]})`),
      ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    }
    expect(await bloqueosAsesores(clave)).toBe(0);
  });

  it('la sentencia ni siquiera llega a la base: ninguna sesión de la API registra su texto', async () => {
    const marcador = `marcador_${textoUnico('cruda').replaceAll('-', '_')}`;
    await expect(sequelize.query(`SELECT 1 AS ${marcador}`)).rejects.toBeInstanceOf(
      ContextoEmpresaAusenteError,
    );
    expect(await sesionesConMarcador(marcador)).toBe(0);
  });

  it('un INSERT crudo rechazado no deja ninguna fila (comprobado con el administrador)', async () => {
    const nombre = textoUnico('Fantasma');
    await expect(
      sequelize.query(
        `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion)
         VALUES (:empresa, :emisor, :nombre, '0098', 'Calle 2')`,
        {
          replacements: { empresa: A.id, emisor: A.emisores[0]!.id, nombre },
        },
      ),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    const { rows } = await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [nombre]);
    expect(rows).toHaveLength(0);
  });

  it('una transacción abierta a mano con sequelize.transaction() no sirve para saltarse el contexto', async () => {
    const clave = claveAsesora();
    const intento = async () => {
      const transaccion = await sequelize.transaction();
      try {
        await sequelize.query(`SELECT pg_advisory_lock(${clave[0]}, ${clave[1]})`, {
          transaction: transaccion,
        });
        await sequelize.query('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
          transaction: transaccion,
        });
      } finally {
        await transaccion.rollback().catch(() => undefined);
      }
    };
    await expect(intento()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(await bloqueosAsesores(clave)).toBe(0);
  });

  it('una transacción manual con una consulta sobre sucursal tampoco devuelve filas ni errores de la base', async () => {
    const intento = async () => {
      const transaccion = await sequelize.transaction();
      try {
        return await sequelize.query('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
          transaction: transaccion,
        });
      } finally {
        await transaccion.rollback().catch(() => undefined);
      }
    };
    await expect(intento()).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });
});

describe('criterio 22 · el contexto no sobrevive a ContextoEmpresa.ejecutar', () => {
  it('tras confirmar una transacción con contexto, la consulta cruda vuelve a fallar', async () => {
    const dentro = await contexto.ejecutar(A.id, () =>
      sequelize.query('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    );
    expect(dentro.length).toBeGreaterThan(0);
    await expect(
      sequelize.query('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('tras revertir una transacción con contexto, la consulta cruda vuelve a fallar', async () => {
    await expect(
      contexto.ejecutar(A.id, async () => {
        await sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
        throw new Error('falla a propósito');
      }),
    ).rejects.toThrow('falla a propósito');
    await expect(
      sequelize.query('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });
});

describe('caso límite · operaciones fuera de HTTP (colas, tareas programadas) sin ContextoEmpresa.ejecutar', () => {
  it('una tarea diferida con setImmediate o setTimeout falla con ContextoEmpresaAusenteError', async () => {
    const enSetImmediate = new Promise((resolver, rechazar) => {
      setImmediate(() => {
        sequelize
          .query('SELECT id FROM sucursal', { type: QueryTypes.SELECT })
          .then(resolver, rechazar);
      });
    });
    await expect(enSetImmediate).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);

    const enSetTimeout = new Promise((resolver, rechazar) => {
      setTimeout(() => {
        sequelize
          .query('SELECT id FROM empresa', { type: QueryTypes.SELECT })
          .then(resolver, rechazar);
      }, 5);
    });
    await expect(enSetTimeout).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('una tarea lanzada sin esperar mientras otra petición tiene contexto no hereda ese contexto', async () => {
    const clave = claveAsesora();
    let tareaAjena: Promise<unknown> = Promise.resolve();
    // El contexto de A existe en este flujo; la tarea nace en otro flujo asíncrono (fuera del contexto).
    const tareaFueraDelContexto = new Promise<void>((arrancar) => {
      setImmediate(() => {
        // Se captura el resultado de inmediato para que el rechazo no quede sin manejar.
        tareaAjena = sequelize.query(`SELECT pg_advisory_lock(${clave[0]}, ${clave[1]})`).then(
          () => null,
          (error: unknown) => error,
        );
        arrancar();
      });
    });
    await contexto.ejecutar(A.id, async () => {
      await tareaFueraDelContexto;
      await new Promise((resolver) => setTimeout(resolver, 20));
    });
    expect(await tareaAjena).toBeInstanceOf(ContextoEmpresaAusenteError);
    expect(await bloqueosAsesores(clave)).toBe(0);
  });

  it('envolver el trabajo en ContextoEmpresa.ejecutar lo habilita', async () => {
    const filas = await new Promise<{ id: string }[]>((resolver, rechazar) => {
      setImmediate(() => {
        contexto
          .ejecutar(A.id, () =>
            sequelize.query<{ id: string }>('SELECT id FROM sucursal', {
              type: QueryTypes.SELECT,
            }),
          )
          .then(resolver, rechazar);
      });
    });
    expect(ids(filas)).toEqual(ids(A.sucursales));
  });
});

describe('criterio 22 · dentro de ContextoEmpresa.ejecutar la consulta cruda funciona', () => {
  it('en el contexto de A, un SELECT crudo sobre sucursal solo ve las filas de A', async () => {
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query<{ id: string }>('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    );
    expect(ids(filas)).toEqual(ids(A.sucursales));
    expect(filas.map((f) => f.id)).not.toContain(B.sucursales[0]!.id);
  });

  it('en el contexto de A, un SELECT crudo sobre emisor y sobre empresa solo ve lo de A', async () => {
    const { emisores, empresas } = await contexto.ejecutar(A.id, async () => ({
      emisores: await sequelize.query<{ id: string }>('SELECT id FROM emisor', {
        type: QueryTypes.SELECT,
      }),
      empresas: await sequelize.query<{ id: string }>('SELECT id FROM empresa', {
        type: QueryTypes.SELECT,
      }),
    }));
    expect(ids(emisores)).toEqual(ids(A.emisores));
    expect(empresas.map((f) => f.id)).toEqual([A.id]);
  });

  it('en el contexto de A, pedir por id la sucursal de B con replacements devuelve 0 filas', async () => {
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query('SELECT id FROM sucursal WHERE id = :id', {
        type: QueryTypes.SELECT,
        replacements: { id: B.sucursales[0]!.id },
      }),
    );
    expect(filas).toHaveLength(0);
  });

  it('la consulta cruda acepta bind dentro del contexto y sigue limitada a la empresa', async () => {
    const propia = await contexto.ejecutar(A.id, () =>
      sequelize.query<{ id: string }>('SELECT id FROM sucursal WHERE id = $1', {
        type: QueryTypes.SELECT,
        bind: [A.sucursales[0]!.id],
      }),
    );
    expect(propia.map((f) => f.id)).toEqual([A.sucursales[0]!.id]);

    const ajena = await contexto.ejecutar(A.id, () =>
      sequelize.query('SELECT id FROM sucursal WHERE id = $1', {
        type: QueryTypes.SELECT,
        bind: [B.sucursales[0]!.id],
      }),
    );
    expect(ajena).toHaveLength(0);
  });

  it('la misma consulta cruda en el contexto de B solo ve las filas de B', async () => {
    const filas = await contexto.ejecutar(B.id, () =>
      sequelize.query<{ id: string }>('SELECT id FROM sucursal', { type: QueryTypes.SELECT }),
    );
    expect(ids(filas)).toEqual(ids(B.sucursales));
  });

  it('contextos de A y B concurrentes con consultas crudas no se mezclan', async () => {
    const consultar = (empresa: EmpresaSql) =>
      contexto.ejecutar(empresa.id, async () => {
        const antes = await sequelize.query<{ id: string }>('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
        });
        await new Promise((resolver) => setTimeout(resolver, 15));
        const despues = await sequelize.query<{ id: string }>('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
        });
        return { antes: ids(antes), despues: ids(despues) };
      });
    const resultados = await Promise.all([A, B, A, B, A, B].map(consultar));
    resultados.forEach((resultado, i) => {
      const esperado = ids((i % 2 === 0 ? A : B).sucursales);
      expect(resultado.antes).toEqual(esperado);
      expect(resultado.despues).toEqual(esperado);
    });
  });

  it('un INSERT crudo con la empresa propia funciona dentro del contexto y uno ajeno falla en la base', async () => {
    const nombre = textoUnico('Propia');
    const insertar = (empresa: EmpresaSql, otra: EmpresaSql, nombreSucursal: string) =>
      contexto.ejecutar(
        empresa.id,
        () =>
          sequelize.query(
            `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion)
           VALUES (:empresa, :emisor, :nombre, '0077', 'Calle 3')`,
            {
              replacements: {
                empresa: otra.id,
                emisor: otra.emisores[0]!.id,
                nombre: nombreSucursal,
              },
            },
          ),
        // Sección 002 (P10): toda escritura corre con actor (criterio 115).
        { actor: { sistema: 'prueba' } },
      );

    await insertar(A, A, nombre);
    const { rows } = await admin.query<{ empresa_id: string }>(
      'SELECT empresa_id FROM sucursal WHERE nombre = $1',
      [nombre],
    );
    expect(rows).toEqual([{ empresa_id: A.id }]);

    const ajeno = textoUnico('Ajena');
    const error = await insertar(A, B, ajeno).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(ContextoEmpresaAusenteError);
    // Con el actor fijado, el rechazo es el de la política RLS y no el de "contexto de actor ausente".
    const mensaje = (error as { parent?: { message?: string }; message?: string }).parent?.message;
    expect(mensaje ?? String(error)).toMatch(/row-level security/);
    const { rows: huerfanas } = await admin.query('SELECT 1 FROM sucursal WHERE nombre = $1', [
      ajeno,
    ]);
    expect(huerfanas).toHaveLength(0);
  });
});
