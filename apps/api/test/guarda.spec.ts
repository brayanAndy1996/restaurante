import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Sequelize } from 'sequelize';
import { QueryTypes } from 'sequelize';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import { CONEXION_API, ConsultaProhibidaError } from '../src/nucleo/base-de-datos';
import {
  ContextoEmpresa,
  ContextoEmpresaAusenteError,
  ContextoEmpresaConflictoError,
} from '../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from './utilidades';
import { crearEmpresaSql, type EmpresaSql } from './aislamiento/fabrica';

// Guarda de consultas de la API (criterio 22, consultas crudas) y marca `sinEmpresa`.
// Pruebas del desarrollador (no protegidas); complementan las de test/aislamiento/.

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let plataforma: Client;
let A: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 1 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
});
afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

const crudas = ['SELECT 1', 'SELECT * FROM sucursal', "SELECT set_config('x.y', '1', true)"];

describe('consultas crudas por CONEXION_API', () => {
  it.each(crudas)(
    'fuera de ContextoEmpresa.ejecutar lanzan ContextoEmpresaAusenteError: %s',
    async (sql) => {
      await expect(sequelize.query(sql, { type: QueryTypes.SELECT })).rejects.toBeInstanceOf(
        ContextoEmpresaAusenteError,
      );
      await expect(sequelize.query({ query: sql, values: [] })).rejects.toBeInstanceOf(
        ContextoEmpresaAusenteError,
      );
    },
  );

  it('dentro de ContextoEmpresa.ejecutar funcionan y solo ven la empresa del contexto', async () => {
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query<{ id: string; empresa_id: string }>('SELECT id, empresa_id FROM sucursal', {
        type: QueryTypes.SELECT,
      }),
    );
    expect(filas.map((f) => f.id).sort()).toEqual(A.sucursales.map((s) => s.id).sort());
    expect(filas.every((f) => f.empresa_id === A.id)).toBe(true);
  });

  it('una transacción abierta a mano en la conexión no sirve para consultar', async () => {
    const transaccion = await sequelize.transaction();
    try {
      await expect(
        sequelize.query('SELECT * FROM sucursal', { transaction: transaccion }),
      ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    } finally {
      await transaccion.rollback();
    }
  });

  it('el pool queda usable tras los rechazos (no se pierden conexiones)', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(sequelize.query('SELECT 1')).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    }
    const n = await contexto.ejecutar(A.id, () =>
      sequelize.query<{ n: string }>('SELECT count(*) AS n FROM sucursal', {
        type: QueryTypes.SELECT,
      }),
    );
    expect(Number(n[0]?.n)).toBe(A.sucursales.length);
  });
});

describe('marca sinEmpresa', () => {
  it('SELECT 1 AS ok con sinEmpresa: salud funciona fuera de un contexto', async () => {
    const filas = await sequelize.query('SELECT 1 AS ok', {
      type: QueryTypes.SELECT,
      sinEmpresa: 'salud',
    } as never);
    expect(filas).toEqual([{ ok: 1 }]);
  });

  it.each([
    ['otra consulta con motivo salud', 'SELECT * FROM sucursal', 'salud'],
    ['otra consulta con motivo verificacion-roles', 'SELECT * FROM empresa', 'verificacion-roles'],
    ['el SQL de salud con el motivo de roles', 'SELECT 1 AS ok', 'verificacion-roles'],
    ['un motivo inventado', 'SELECT 1 AS ok', 'cualquiera'],
  ])('no deja pasar %s', async (_n, sql, motivo) => {
    await expect(
      sequelize.query(sql, { type: QueryTypes.SELECT, sinEmpresa: motivo } as never),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
  });

  it('no deja pasar la consulta de salud con parámetros ni con una transacción', async () => {
    await expect(
      sequelize.query('SELECT 1 AS ok', { sinEmpresa: 'salud', bind: [] } as never),
    ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    const transaccion = await sequelize.transaction();
    try {
      await expect(
        sequelize.query('SELECT 1 AS ok', {
          sinEmpresa: 'salud',
          transaction: transaccion,
        } as never),
      ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    } finally {
      await transaccion.rollback();
    }
  });

  it('no se puede usar dentro de un contexto de empresa', async () => {
    await contexto.ejecutar(A.id, async () => {
      await expect(
        sequelize.query('SELECT 1 AS ok', {
          type: QueryTypes.SELECT,
          sinEmpresa: 'salud',
        } as never),
      ).rejects.toBeInstanceOf(ContextoEmpresaAusenteError);
    });
  });
});

describe('el contexto no se puede cambiar con SQL dentro de la transacción', () => {
  it.each([
    ["SELECT 1; SELECT set_config('app.empresa_id', $1, true)"],
    ["SET LOCAL app.empresa_id = 'x'"],
    ['RESET ALL'],
    ['SELECT 1; SET ROLE restaurante_migrador'],
    ['DO $$ BEGIN PERFORM 1; END $$'],
  ])('%s se rechaza', async (sql) => {
    await contexto.ejecutar(A.id, async () => {
      const bind = sql.includes('$1') ? { bind: [randomUUID()] } : {};
      await expect(sequelize.query(sql, bind)).rejects.toBeInstanceOf(ConsultaProhibidaError);
      // La transacción sigue sana: el rechazo fue de la guarda, no de la base.
      const filas = await sequelize.query('SELECT count(*) AS n FROM sucursal', {
        type: QueryTypes.SELECT,
      });
      expect(filas).toHaveLength(1);
    });
  });

  // Defensa añadida al decidir sobre el texto sin literales (criterio 22b): lo que sigue cambia el
  // contexto o ejecuta SQL armado como texto, así que se rechaza aunque no lo diga una palabra suelta.
  it.each([
    ['set_config como identificador entre comillas', `SELECT "set_config"('a.b', 'c', true)`],
    [
      'set_config con escapes Unicode en el identificador',
      `SELECT U&"set\\005fconfig"('a.b','c',true)`,
    ],
    [
      'UPDATE de pg_settings (equivale a set_config)',
      `UPDATE pg_settings SET setting = 'x' WHERE name = 'app.empresa_id'`,
    ],
    [
      'query_to_xml (ejecuta la consulta que recibe)',
      `SELECT query_to_xml('select 1', true, false, '')`,
    ],
    ['ts_stat (ejecuta la consulta que recibe)', `SELECT * FROM ts_stat('select 1::tsvector')`],
    ['texto sin cerrar', `SELECT 'sin cerrar`],
  ])('%s se rechaza', async (_nombre, sql) => {
    await contexto.ejecutar(A.id, async () => {
      await expect(sequelize.query(sql)).rejects.toBeInstanceOf(ConsultaProhibidaError);
    });
  });

  it('los mismos nombres dentro de un valor no se rechazan', async () => {
    await contexto.ejecutar(A.id, async () => {
      const filas = await sequelize.query(
        `SELECT id FROM sucursal WHERE nombre = 'pg_settings query_to_xml ts_stat set_config'`,
        { type: QueryTypes.SELECT },
      );
      expect(filas).toEqual([]);
    });
  });

  it('fijar el contexto otra vez en la misma transacción lanza un conflicto', async () => {
    await contexto.ejecutar(A.id, async () => {
      await expect(
        sequelize.query('SELECT fijar_contexto_empresa($1)', { bind: [randomUUID()] }),
      ).rejects.toBeInstanceOf(ContextoEmpresaConflictoError);
    });
  });

  it('fijar el contexto con otro texto (esquema, comillas, sin parámetro) se rechaza antes de la base', async () => {
    await contexto.ejecutar(A.id, async () => {
      for (const sql of [
        'SELECT public.fijar_contexto_empresa($1)',
        'SELECT "fijar_contexto_empresa"($1)',
        "SELECT fijar_contexto_empresa('00000000-0000-0000-0000-000000000000')",
      ]) {
        await expect(sequelize.query(sql, { bind: [randomUUID()] })).rejects.toBeInstanceOf(
          ConsultaProhibidaError,
        );
      }
      // La transacción sigue sana: el rechazo fue de la guarda y la base no vio nada.
      const filas = await sequelize.query('SELECT count(*) AS n FROM sucursal', {
        type: QueryTypes.SELECT,
      });
      expect(filas).toHaveLength(1);
    });
  });
});
