// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 22b (aclaración de la ronda 3): el rechazo de la guarda de consultas se decide sobre el
// texto SIN literales ni comentarios. Dentro de `ContextoEmpresa.ejecutar`, un valor que contiene
// `set_config`, `SET`, `RESET` o `;` (por ejemplo `'x; set y'`) no se rechaza: la sentencia se ejecuta
// normalmente y el valor se compara o se guarda tal cual (también con `E'…'`, `$$…$$` y comentarios).
// Los controles comprueban que las sentencias reales de cambio de sesión siguen rechazadas.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API, ConsultaProhibidaError } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, type EmpresaSql } from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let admin: Client;
let plataforma: Client;
let A: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

const dentro = <T>(fn: () => Promise<T>) => contexto.ejecutar(A.id, fn);

describe('criterio 22b · literales que parecen sentencias de sesión no se rechazan', () => {
  const COMPARACIONES: { nombre: string; literal: string }[] = [
    { nombre: "con punto y coma y 'set'", literal: `'x; set y'` },
    { nombre: "con 'set_config'", literal: `'set_config'` },
    { nombre: "con 'RESET all'", literal: `'RESET all'` },
    { nombre: "con 'SET' solo", literal: `'SET'` },
    { nombre: "con 'DISCARD ALL; DO'", literal: `'DISCARD ALL; DO'` },
    { nombre: 'con E-string', literal: `E'x; set y'` },
    { nombre: 'con comillas de dólar', literal: `$$x; set y$$` },
    { nombre: 'con comillas de dólar con etiqueta', literal: `$q$set_config('a'); RESET all$q$` },
    { nombre: 'con una comilla escapada dentro', literal: `'it''s; set y'` },
  ];

  it.each(COMPARACIONES)(
    'SELECT … WHERE nombre = literal $nombre se ejecuta sin error',
    async ({ literal }) => {
      const filas = await dentro(() =>
        sequelize.query(`SELECT id FROM sucursal WHERE nombre = ${literal}`, {
          type: QueryTypes.SELECT,
        }),
      );
      expect(filas).toEqual([]);
    },
  );

  it.each([
    ['comentario de bloque con set_config', `SELECT id FROM sucursal /* set_config; RESET all */`],
    ['comentario de línea con SET', `SELECT id FROM sucursal -- SET x = 1; DISCARD ALL\n`],
  ])('un %s no se rechaza', async (_nombre, sql) => {
    const filas = await dentro(() => sequelize.query(sql, { type: QueryTypes.SELECT }));
    expect(filas).toHaveLength(A.sucursales.length);
  });

  it("UPDATE … SET direccion = 'x; set y' se ejecuta y el valor se guarda tal cual", async () => {
    const id = A.sucursales[0]!.id;
    await dentro(() =>
      sequelize.query(`UPDATE sucursal SET direccion = 'x; set y' WHERE id = '${id}'`),
    );
    const { rows } = await admin.query<{ direccion: string }>(
      'SELECT direccion FROM sucursal WHERE id = $1',
      [id],
    );
    expect(rows[0]!.direccion).toBe('x; set y');
  });

  it('un nombre de sucursal con el texto set_config se guarda tal cual y se encuentra por ese valor', async () => {
    const id = A.sucursales[1]!.id;
    const nombre = `Sede set_config; RESET all ${Date.now()}`;
    await dentro(() =>
      sequelize.query('UPDATE sucursal SET nombre = $1 WHERE id = $2', { bind: [nombre, id] }),
    );
    const filas = await dentro(() =>
      sequelize.query<{ id: string }>('SELECT id FROM sucursal WHERE nombre = $1', {
        bind: [nombre],
        type: QueryTypes.SELECT,
      }),
    );
    expect(filas.map((f) => f.id)).toEqual([id]);
  });

  it('el literal no cambia el contexto: la consulta sigue viendo solo la empresa A', async () => {
    const filas = await dentro(() =>
      sequelize.query<{ id: string }>(`SELECT id FROM sucursal WHERE nombre <> 'x; set y'`, {
        type: QueryTypes.SELECT,
      }),
    );
    expect(filas.map((f) => f.id).sort()).toEqual(A.sucursales.map((s) => s.id).sort());
  });
});

describe('criterio 22b · controles: las sentencias reales de sesión siguen rechazadas', () => {
  it.each([
    ['set_config real', `SELECT set_config('search_path', 'x', true)`],
    ['RESET real', 'RESET ALL'],
    ['SET real', `SET search_path = public`],
    ['SET tras un literal con punto y coma', `SELECT 'a;b'; SET search_path = public`],
    ['set_config real después de un literal', `SELECT 'x' AS a, set_config('a.b', 'c', true)`],
    ['DISCARD real', 'DISCARD ALL'],
  ])('%s lanza ConsultaProhibidaError', async (_nombre, sql) => {
    await dentro(async () => {
      await expect(sequelize.query(sql)).rejects.toBeInstanceOf(ConsultaProhibidaError);
    });
  });
});
