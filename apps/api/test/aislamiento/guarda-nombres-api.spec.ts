// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 38e, incisos (d) y (e): guarda por nombre de la API. Dentro de `ContextoEmpresa.ejecutar(A)`,
// toda sentencia que mencione, fuera de literales y comentarios, alguno de los nombres de la lista (nombres
// completos y prefijos `pg_stat_get_backend_` y `lo_`, además de `set_config`, `pg_settings`, `ts_rewrite`,
// `ts_stat`, `query_to_xml*`, `cursor_to_xml*`, `table_to_xml*`, `schema_to_xml*`, `database_to_xml*` y
// `fijar_contexto_empresa`), sola o calificada con esquema, entre comillas dobles, en mayúsculas, tras otra
// sentencia permitida en el mismo texto y tras comentarios, lanza un error que no es `DatabaseError` (es
// decir, no llegó a la base). Después, en la misma transacción, un `SELECT` sobre `sucursal` funciona y solo
// devuelve filas de A. Los controles (alias con el nombre dentro de otro identificador, literales y
// comentarios con esos textos) funcionan. Un identificador `U&"…"` se rechaza siempre.
// La lista y sus variantes están en `nombres-prohibidos.ts`.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, type EmpresaSql } from './fabrica';
import { CONTROLES_ALIAS, ENTRADAS, ESCAPES_UNICODE, variantes } from './nombres-prohibidos';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;
let admin: Client;
let plataforma: Client;
let A: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion({ logger: false });
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

type Fila = { id: string };
const idsDe = (empresa: EmpresaSql) => empresa.sucursales.map((s) => s.id).sort();

const describir = (valor: unknown) =>
  valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : String(valor);

/**
 * Corre `sql` dentro de `ejecutar(A)` y luego un SELECT sobre sucursal en la misma transacción. Devuelve
 * un texto con el problema, o `null` si la sentencia se rechazó antes de la base y la transacción sigue sana.
 */
async function problemaAlRechazar(sql: string): Promise<string | null> {
  const visto = await contexto.ejecutar(A.id, async () => {
    let error: unknown;
    try {
      await sequelize.query(sql);
    } catch (e) {
      error = e;
    }
    let lectura: Fila[] | string;
    try {
      lectura = await sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
    } catch (e) {
      lectura = describir(e);
    }
    return { error, lectura };
  });
  if (visto.error === undefined) return 'la sentencia tuvo éxito (no se rechazó)';
  if (visto.error instanceof DatabaseError) {
    return `llegó a la base: ${describir(visto.error)}`;
  }
  if (!(visto.error instanceof Error))
    return `se lanzó un valor que no es un Error: ${String(visto.error)}`;
  if (typeof visto.lectura === 'string') return `el SELECT posterior falló: ${visto.lectura}`;
  const vistos = visto.lectura.map((f) => f.id).sort();
  if (JSON.stringify(vistos) !== JSON.stringify(idsDe(A))) {
    return `el SELECT posterior no devolvió solo las filas de A: ${vistos.join(',')}`;
  }
  return null;
}

describe('criterio 38e (d, e) · la guarda de la API rechaza por nombre antes de la base', () => {
  it.each(ENTRADAS.map((e) => [e.nombre, e] as const))(
    '%s se rechaza en todas sus variantes y el SELECT posterior solo ve filas de A',
    async (_nombre, entrada) => {
      const problemas: string[] = [];
      for (const [descripcion, sql] of variantes(entrada)) {
        const problema = await problemaAlRechazar(sql);
        if (problema !== null) {
          problemas.push(`[${descripcion}] ${JSON.stringify(sql)} → ${problema}`);
        }
      }
      expect(problemas, problemas.join('\n')).toEqual([]);
    },
  );

  it('un identificador con escapes Unicode (U&"…") que podría escribir un nombre se rechaza siempre', async () => {
    const problemas: string[] = [];
    for (const [descripcion, sql] of ESCAPES_UNICODE) {
      const problema = await problemaAlRechazar(sql);
      if (problema !== null) problemas.push(`[${descripcion}] → ${problema}`);
    }
    expect(problemas, problemas.join('\n')).toEqual([]);
  });
});

describe('criterio 38e (e) · controles: lo que no es uno de los nombres funciona', () => {
  it('alias que contienen un nombre dentro de otro identificador se ejecutan', async () => {
    const columnas = CONTROLES_ALIAS.map((alias, i) => `${i + 1} AS ${alias}`).join(', ');
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query<Record<string, number>>(`SELECT ${columnas}`, { type: QueryTypes.SELECT }),
    );
    expect(filas).toHaveLength(1);
    expect(Object.keys(filas[0]!).sort()).toEqual([...CONTROLES_ALIAS].sort());
  });

  it.each(CONTROLES_ALIAS)(
    'el alias %s se ejecuta y la transacción solo ve filas de A',
    async (alias) => {
      const filas = await contexto.ejecutar(A.id, async () => {
        await sequelize.query(`SELECT 1 AS ${alias}`);
        return sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
      });
      expect(filas.map((f) => f.id).sort()).toEqual(idsDe(A));
    },
  );

  it.each([
    ['comillas simples', `'lo_get pg_stat_activity pg_terminate_backend'`],
    ['E-string', `E'lo_get pg_stat_activity pg_terminate_backend'`],
    ['comillas de dólar', `$$lo_get pg_stat_activity pg_terminate_backend$$`],
    ['comillas de dólar con etiqueta', `$q$lo_get; pg_cancel_backend(1)$q$`],
    ['con nombres de las funciones de XML', `'table_to_xml schema_to_xml database_to_xml'`],
  ])(
    'un UPDATE con un literal (%s) con esos nombres guarda el valor tal cual',
    async (_nombre, literal) => {
      const sucursal = A.sucursales[0]!;
      const esperado = (await admin.query<{ v: string }>(`SELECT ${literal} AS v`)).rows[0]!.v;
      await contexto.ejecutar(
        A.id,
        () =>
          sequelize.query(`UPDATE sucursal SET direccion = ${literal} WHERE id = '${sucursal.id}'`),
        // Sección 002 (P10): toda escritura corre con actor (criterio 115).
        { actor: { sistema: 'prueba' } },
      );
      const { rows } = await admin.query<{ direccion: string }>(
        'SELECT direccion FROM sucursal WHERE id = $1',
        [sucursal.id],
      );
      expect(rows[0]!.direccion).toBe(esperado);
    },
  );

  it('un valor con esos nombres se encuentra por comparación', async () => {
    const sucursal = A.sucursales[1]!;
    const nombre = `Sede lo_get pg_stat_activity ${Date.now()}`;
    await contexto.ejecutar(
      A.id,
      () =>
        sequelize.query('UPDATE sucursal SET nombre = $1 WHERE id = $2', {
          bind: [nombre, sucursal.id],
        }),
      { actor: { sistema: 'prueba' } },
    );
    const filas = await contexto.ejecutar(A.id, () =>
      sequelize.query<Fila>(`SELECT id FROM sucursal WHERE nombre = '${nombre}'`, {
        type: QueryTypes.SELECT,
      }),
    );
    expect(filas.map((f) => f.id)).toEqual([sucursal.id]);
  });

  it.each([
    `/* lo_get pg_stat_activity pg_terminate_backend */ SELECT id FROM sucursal`,
    `-- lo_get pg_stat_activity\nSELECT id FROM sucursal`,
    `-- loread lowrite pg_largeobject\rSELECT id FROM sucursal`,
    `SELECT id FROM sucursal /* table_to_xml schema_to_xml */`,
  ])(
    'un comentario con esos nombres antes o después de un SELECT no se rechaza: %j',
    async (sql) => {
      const filas = await contexto.ejecutar(A.id, () =>
        sequelize.query<Fila>(sql, { type: QueryTypes.SELECT }),
      );
      expect(filas.map((f) => f.id).sort()).toEqual(idsDe(A));
    },
  );
});
