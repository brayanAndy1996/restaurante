// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 22d (falla CRÍTICA de la ronda 4 del adversarial): el contexto de empresa de una transacción
// es inmutable para el código de la aplicación. Funciones del catálogo que ejecutan SQL arbitrario
// desde dentro del servidor (`ts_rewrite`, `ts_stat`, `query_to_xml`, `query_to_xmlschema`,
// `query_to_xml_and_xmlschema`, `cursor_to_xml`, `cursor_to_xmlschema`) o la vista actualizable
// `pg_settings` permitían llamar `set_config('app.empresa_id', <B>, true)` sin que la guarda lo viera;
// después de eso `SELECT ... FROM sucursal` devolvía las filas de B y un `UPDATE` sobre B se confirmaba.
//
// Tres capas, cada una por sí sola suficiente:
// 1. La guarda de la API (dentro de `ContextoEmpresa.ejecutar(A, fn)`) rechaza esas llamadas, o la base
//    responde 42501 (cualquiera de las dos; nunca éxito), y el contexto sigue siendo A.
// 2. La guarda solo admite sentencias que empiezan por SELECT, INSERT, UPDATE, DELETE, WITH, VALUES o
//    TABLE (lista blanca): lo demás se rechaza antes de llegar a la base.
// 3. La base de datos, sin la guarda: `restaurante_api` y `restaurante_plataforma` no tienen EXECUTE
//    sobre esas funciones ni UPDATE sobre `pg_settings` (42501); `restaurante_api` sí conserva
//    `set_config` (es de PUBLIC), pero desde el criterio 22e ya no lo necesita para fijar el contexto
//    (lo fija `fijar_contexto_empresa`) ni le sirve para cambiarlo (la RLS no lee `app.empresa_id`).
import type { INestApplication } from '@nestjs/common';
import type { Client, DatabaseError } from 'pg';
import { DatabaseError as ErrorDeBaseSequelize, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import {
  crearEmpresaSql,
  enTransaccion,
  errorDe,
  fotoDeFila,
  textoUnico,
  type EmpresaSql,
} from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;

/**
 * Sección 002 (P10): `ContextoEmpresa.ejecutar` con el actor de sistema `prueba`. Toda escritura de una
 * transacción necesita actor (criterio 115); estas pruebas siguen verificando lo mismo que antes.
 */
const ejecutarConActor = <T>(empresaId: string, fn: () => Promise<T>): Promise<T> =>
  contexto.ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });

let admin: Client;
let plataforma: Client;
let clienteApi: Client;
let clientePlataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  clienteApi = await abrirCliente('api');
  clientePlataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
  // Si alguna sentencia de la lista blanca llegara a ejecutarse, no debe quedar un valor por defecto en el rol.
  await admin.query('ALTER ROLE restaurante_api RESET app.empresa_id');
});

afterAll(async () => {
  await admin?.query('ALTER ROLE restaurante_api RESET app.empresa_id');
  await app?.close();
  await admin?.end();
  await plataforma?.end();
  await clienteApi?.end();
  await clientePlataforma?.end();
});

type Fila = { nombre: string };
const nombresDe = (empresa: EmpresaSql) => empresa.sucursales.map((s) => s.nombre).sort();
const ordenados = (filas: Fila[]) => filas.map((f) => f.nombre).sort();

/** Resultado de intentar algo sin que una excepción corte la prueba. */
type Intento<T> = { ok: true; valor: T } | { ok: false; error: unknown };
async function intentar<T>(fn: () => Promise<T>): Promise<Intento<T>> {
  try {
    return { ok: true, valor: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function codigoDeBase(error: unknown): string | undefined {
  const origen = (error as { parent?: { code?: string }; code?: string } | undefined) ?? {};
  return origen.parent?.code ?? origen.code;
}

const describir = (valor: unknown) =>
  valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : JSON.stringify(valor);

// --------------------------------------------------------------------------------------------------
// Las formas de ejecutar SQL desde dentro del servidor que cambian el contexto. `b` es el id de la
// empresa B; la SQL interna es siempre `SELECT set_config('app.empresa_id', '<B>', true)...`.
// Con `armado` el nombre del parámetro no aparece como texto en la consulta (`'app'||chr(46)||'empresa_id'`),
// así que ninguna búsqueda del literal puede detectarlo: solo la lista blanca o los permisos lo frenan.
// --------------------------------------------------------------------------------------------------
const nombreDelParametro = (armado: boolean, c: "'" | "''") =>
  armado ? `${c}app${c}||chr(46)||${c}empresa_id${c}` : `${c}app.empresa_id${c}`;
const interna = (b: string, armado = false) =>
  `SELECT set_config(${nombreDelParametro(armado, "''")},''${b}'',true)`;
const internaSimple = (b: string, armado = false) =>
  `SELECT set_config(${nombreDelParametro(armado, "'")},'${b}',true)`;

const ataquesPorApi = (armado: boolean): [string, (b: string) => string][] => {
  const reescribir = (b: string) => `'x'::tsquery,'${interna(b, armado)}::tsquery, ''y''::tsquery'`;
  return [
    ['ts_rewrite', (b) => `SELECT ts_rewrite(${reescribir(b)})`],
    ['pg_catalog.ts_rewrite', (b) => `SELECT pg_catalog.ts_rewrite(${reescribir(b)})`],
    ['"ts_rewrite" entre comillas', (b) => `SELECT "ts_rewrite"(${reescribir(b)})`],
    [
      '"pg_catalog"."ts_rewrite" entre comillas',
      (b) => `SELECT "pg_catalog"."ts_rewrite"(${reescribir(b)})`,
    ],
    ['TS_REWRITE en mayúsculas', (b) => `SELECT TS_REWRITE(${reescribir(b)})`],
    ['ts_stat', (b) => `SELECT * FROM ts_stat('${interna(b, armado)}::tsvector')`],
    ['query_to_xml', (b) => `SELECT query_to_xml('${interna(b, armado)}', true, false, '')`],
    [
      'query_to_xml_and_xmlschema',
      (b) => `SELECT query_to_xml_and_xmlschema('${interna(b, armado)}', true, false, '')`,
    ],
    [
      'query_to_xmlschema',
      (b) => `SELECT query_to_xmlschema('${interna(b, armado)}', true, false, '')`,
    ],
    [
      'UPDATE pg_settings',
      (b) =>
        `UPDATE pg_settings SET setting = '${b}' WHERE name = ${nombreDelParametro(armado, "'")}`,
    ],
  ];
};

describe.each([
  ['con el nombre del parámetro como texto', false],
  ['con el nombre del parámetro armado en la propia consulta', true],
] as const)('criterio 22d · por la API · %s', (_etiqueta, armado) => {
  describe.each(ataquesPorApi(armado))(
    '%s dentro de ejecutar(A) no cambia el contexto',
    (_nombre, sqlDe) => {
      it('la consulta lanza un error (antes de la base o 42501) y el contexto sigue siendo A', async () => {
        const sucursalDeB = B.sucursales[0]!.id;
        const antes = await fotoDeFila(admin, 'sucursal', sucursalDeB);

        const visto = await ejecutarConActor(A.id, async () => {
          const ataque = await intentar(() => sequelize.query(sqlDe(B.id)));
          const lectura = await intentar(() =>
            sequelize.query<Fila>('SELECT nombre FROM sucursal', { type: QueryTypes.SELECT }),
          );
          const escritura = await intentar(() =>
            sequelize.query<{ id: string }>(
              `UPDATE sucursal SET direccion = 'X' WHERE id = '${sucursalDeB}' RETURNING id`,
              { type: QueryTypes.SELECT },
            ),
          );
          return { ataque, lectura, escritura };
        });

        // 1. La llamada nunca tiene éxito.
        expect(visto.ataque.ok, 'la sentencia que cambia el contexto tuvo éxito').toBe(false);
        const errorDelAtaque = (visto.ataque as { error: unknown }).error;
        if (errorDelAtaque instanceof ErrorDeBaseSequelize) {
          // La base respondió: tiene que ser por falta de permiso.
          expect(codigoDeBase(errorDelAtaque), describir(errorDelAtaque)).toBe('42501');
        } else {
          // La guarda rechazó antes de la base: la transacción sigue sana y las lecturas funcionan.
          expect(visto.lectura.ok, `la lectura posterior falló: ${describir(errorDelAtaque)}`).toBe(
            true,
          );
        }

        // 2. Las consultas posteriores solo ven filas de A (o fallan si la transacción quedó abortada).
        if (visto.lectura.ok) {
          expect(ordenados(visto.lectura.valor)).toEqual(nombresDe(A));
        }

        // 3. El UPDATE a la sucursal de B no afecta ninguna fila.
        if (visto.escritura.ok) {
          expect(visto.escritura.valor, 'el UPDATE a una sucursal de B afectó filas').toEqual([]);
        }

        // 4. Desde el administrador: la sucursal de B no cambió.
        expect(await fotoDeFila(admin, 'sucursal', sucursalDeB)).toEqual(antes);
      });
    },
  );
});

// --------------------------------------------------------------------------------------------------
// Lista blanca de la guarda dentro de ejecutar(A).
// --------------------------------------------------------------------------------------------------
describe('criterio 22d · lista blanca de la guarda dentro de ejecutar(A)', () => {
  const RECHAZADAS: [string, (b: string) => string][] = [
    ['ALTER ROLE', (b) => `ALTER ROLE restaurante_api SET app.empresa_id = '${b}'`],
    ['PREPARE', () => 'PREPARE p AS SELECT 1'],
    ['EXECUTE', () => 'EXECUTE p'],
    ['DECLARE', () => 'DECLARE c CURSOR FOR SELECT 1'],
    ['COPY', () => 'COPY (SELECT 1) TO STDOUT'],
    ['LISTEN', () => 'LISTEN x'],
    ['NOTIFY', () => 'NOTIFY x'],
    ['LOCK TABLE', () => 'LOCK TABLE sucursal'],
    ['EXPLAIN', () => 'EXPLAIN SELECT 1'],
    ['ANALYZE', () => 'ANALYZE sucursal'],
    ['CALL', () => 'CALL x()'],
    ['SHOW', () => 'SHOW app.empresa_id'],
    [
      'segunda sentencia (SELECT 1; ALTER ROLE ...)',
      (b) => `SELECT 1; ALTER ROLE restaurante_api SET app.empresa_id = '${b}'`,
    ],
  ];

  it.each(RECHAZADAS)(
    '%s se rechaza antes de la base (error que no es DatabaseError de Sequelize)',
    async (_nombre, sqlDe) => {
      const resultado = await intentar(() =>
        ejecutarConActor(A.id, async () => {
          await sequelize.query(sqlDe(B.id));
        }),
      );
      expect(resultado.ok, 'la sentencia no se rechazó').toBe(false);
      const error = (resultado as { error: unknown }).error;
      expect(error).toBeInstanceOf(Error);
      expect(error instanceof ErrorDeBaseSequelize, `llegó a la base: ${describir(error)}`).toBe(
        false,
      );
    },
  );

  describe('controles · sentencias permitidas', () => {
    it('SELECT, WITH, VALUES y TABLE funcionan y solo ven filas de A', async () => {
      await ejecutarConActor(A.id, async () => {
        const uno = await sequelize.query<{ uno: number }>('SELECT 1 AS uno', {
          type: QueryTypes.SELECT,
        });
        expect(uno).toEqual([{ uno: 1 }]);

        const conWith = await sequelize.query<{ x: number }>(
          'WITH x AS (SELECT 1 AS x) SELECT * FROM x',
          { type: QueryTypes.SELECT },
        );
        expect(conWith).toEqual([{ x: 1 }]);

        const valores = await sequelize.query<{ column1: number }>('VALUES (1)', {
          type: QueryTypes.SELECT,
        });
        expect(valores).toEqual([{ column1: 1 }]);

        const tabla = await sequelize.query<Fila>('TABLE sucursal', { type: QueryTypes.SELECT });
        expect(ordenados(tabla)).toEqual(nombresDe(A));

        const lectura = await sequelize.query<Fila>('SELECT nombre FROM sucursal', {
          type: QueryTypes.SELECT,
        });
        expect(ordenados(lectura)).toEqual(nombresDe(A));
      });
    });

    it('un SELECT precedido de comentarios funciona', async () => {
      await ejecutarConActor(A.id, async () => {
        const filas = await sequelize.query<{ uno: number }>(
          '/* comentario */ -- otro comentario\nSELECT 1 AS uno',
          { type: QueryTypes.SELECT },
        );
        expect(filas).toEqual([{ uno: 1 }]);
      });
    });

    it('INSERT, UPDATE y DELETE sobre filas de A funcionan', async () => {
      const nombre = textoUnico('Sucursal-control');
      await ejecutarConActor(A.id, async () => {
        const insertadas = await sequelize.query<{ id: string }>(
          `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
           VALUES ('${A.id}', '${A.emisores[0]!.id}', '${nombre}', '0777', 'Calle control 1, Lima', now(), now())
           RETURNING id`,
          { type: QueryTypes.SELECT },
        );
        expect(insertadas).toHaveLength(1);
        const id = insertadas[0]!.id;

        const actualizadas = await sequelize.query<{ id: string }>(
          `UPDATE sucursal SET direccion = 'Calle control 2, Lima' WHERE id = '${id}' RETURNING id`,
          { type: QueryTypes.SELECT },
        );
        expect(actualizadas).toHaveLength(1);

        const borradas = await sequelize.query<{ id: string }>(
          `DELETE FROM sucursal WHERE id = '${id}' RETURNING id`,
          { type: QueryTypes.SELECT },
        );
        expect(borradas).toHaveLength(1);
      });
    });
  });
});

// --------------------------------------------------------------------------------------------------
// La base de datos sin la guarda: el permiso lo niega el propio PostgreSQL.
// --------------------------------------------------------------------------------------------------
const FUNCIONES_QUE_EJECUTAN_SQL = [
  'ts_rewrite',
  'ts_stat',
  'query_to_xml',
  'query_to_xmlschema',
  'query_to_xml_and_xmlschema',
  'cursor_to_xml',
  'cursor_to_xmlschema',
] as const;

/** Sentencias (ya con el id de B) que intentan cambiar el contexto a través de una de esas funciones. */
const ATAQUES_EN_LA_BASE: [string, (b: string) => string[]][] = [
  [
    'ts_rewrite',
    (b) => [`SELECT ts_rewrite('x'::tsquery,'${interna(b)}::tsquery, ''y''::tsquery')`],
  ],
  ['ts_stat', (b) => [`SELECT * FROM ts_stat('${interna(b)}::tsvector')`]],
  ['query_to_xml', (b) => [`SELECT query_to_xml('${interna(b)}', true, false, '')`]],
  ['query_to_xmlschema', (b) => [`SELECT query_to_xmlschema('${interna(b)}', true, false, '')`]],
  [
    'query_to_xml_and_xmlschema',
    (b) => [`SELECT query_to_xml_and_xmlschema('${interna(b)}', true, false, '')`],
  ],
  [
    'cursor_to_xml',
    (b) => [
      `DECLARE c_inmutable CURSOR FOR ${internaSimple(b)}`,
      "SELECT cursor_to_xml('c_inmutable', 1, true, false, '')",
    ],
  ],
  [
    'cursor_to_xmlschema',
    (b) => [
      `DECLARE c_inmutable CURSOR FOR ${internaSimple(b)}`,
      "SELECT cursor_to_xmlschema('c_inmutable', true, false, '')",
    ],
  ],
  [
    'UPDATE pg_settings',
    (b) => [`UPDATE pg_settings SET setting = '${b}' WHERE name = 'app.empresa_id'`],
  ],
];

/** Ejecuta las sentencias en orden; la última debe fallar con 42501. Devuelve el error de la última. */
async function ejecutarYEsperarDenegacion(
  cliente: Client,
  sentencias: string[],
  nombre: string,
): Promise<DatabaseError> {
  for (const sentencia of sentencias.slice(0, -1)) await cliente.query(sentencia);
  const ultima = sentencias[sentencias.length - 1]!;
  const error = await errorDe(cliente.query(ultima)).catch(() => {
    throw new Error(`${nombre} tuvo éxito: ${ultima}`);
  });
  return error;
}

describe.each(ATAQUES_EN_LA_BASE)('criterio 22d · en la base · %s', (nombre, sentenciasDe) => {
  it('restaurante_api recibe 42501 y el contexto sigue siendo A', async () => {
    await enTransaccion(clienteApi, A.id, async () => {
      await clienteApi.query('SAVEPOINT intento');
      const error = await ejecutarYEsperarDenegacion(clienteApi, sentenciasDe(B.id), nombre);
      expect(error.code, error.message).toBe('42501');
      await clienteApi.query('ROLLBACK TO SAVEPOINT intento');

      // Tras revertir al SAVEPOINT, en la misma transacción, el contexto sigue siendo A.
      const actual = await clienteApi.query<{ actual: string; copia: string }>(
        `SELECT empresa_actual()::text AS actual, current_setting('app.empresa_id') AS copia`,
      );
      expect(actual.rows[0]).toEqual({ actual: A.id, copia: A.id });
      const { rows } = await clienteApi.query<Fila>('SELECT nombre FROM sucursal');
      expect(ordenados(rows)).toEqual(nombresDe(A));
    });
  });

  it('restaurante_plataforma recibe 42501', async () => {
    await enTransaccion(clientePlataforma, null, async () => {
      await clientePlataforma.query('SAVEPOINT intento');
      const error = await ejecutarYEsperarDenegacion(clientePlataforma, sentenciasDe(B.id), nombre);
      expect(error.code, error.message).toBe('42501');
      await clientePlataforma.query('ROLLBACK TO SAVEPOINT intento');
    });
  });
});

describe('criterio 22d · en la base · catálogo de privilegios', () => {
  async function funcionesPorNombre(
    nombre: string,
  ): Promise<{ oid: string; firma: string; api: boolean; plataforma: boolean }[]> {
    const { rows } = await admin.query<{
      oid: string;
      firma: string;
      api: boolean;
      plataforma: boolean;
    }>(
      `SELECT p.oid::text AS oid,
              p.oid::regprocedure::text AS firma,
              has_function_privilege('restaurante_api', p.oid, 'EXECUTE') AS api,
              has_function_privilege('restaurante_plataforma', p.oid, 'EXECUTE') AS plataforma
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pg_catalog' AND p.proname = $1
        ORDER BY 2`,
      [nombre],
    );
    return rows;
  }

  it.each(FUNCIONES_QUE_EJECUTAN_SQL)(
    '%s: ninguna firma es ejecutable por restaurante_api ni por restaurante_plataforma',
    async (nombre) => {
      const firmas = await funcionesPorNombre(nombre);
      expect(firmas.length, `no se encontró ${nombre} en pg_catalog`).toBeGreaterThan(0);
      expect(
        firmas.filter((f) => f.api).map((f) => f.firma),
        'firmas ejecutables por restaurante_api',
      ).toEqual([]);
      expect(
        firmas.filter((f) => f.plataforma).map((f) => f.firma),
        'firmas ejecutables por restaurante_plataforma',
      ).toEqual([]);
    },
  );

  it('pg_settings no es actualizable por restaurante_api ni por restaurante_plataforma', async () => {
    const { rows } = await admin.query<{ api: boolean; plataforma: boolean }>(
      `SELECT has_table_privilege('restaurante_api', 'pg_settings', 'UPDATE') AS api,
              has_table_privilege('restaurante_plataforma', 'pg_settings', 'UPDATE') AS plataforma`,
    );
    expect(rows[0]).toEqual({ api: false, plataforma: false });
  });

  describe('controles', () => {
    it('restaurante_api conserva EXECUTE sobre set_config', async () => {
      const { rows } = await admin.query<{ api: boolean }>(
        `SELECT has_function_privilege('restaurante_api', 'pg_catalog.set_config(text, text, boolean)', 'EXECUTE') AS api`,
      );
      expect(rows[0]!.api).toBe(true);
    });

    it('restaurante_api puede fijar el contexto con fijar_contexto_empresa en una transacción nueva', async () => {
      await enTransaccion(clienteApi, A.id, async () => {
        const { rows } = await clienteApi.query<Fila>('SELECT nombre FROM sucursal');
        expect(ordenados(rows)).toEqual(nombresDe(A));
      });
      await enTransaccion(clienteApi, B.id, async () => {
        const { rows } = await clienteApi.query<Fila>('SELECT nombre FROM sucursal');
        expect(ordenados(rows)).toEqual(nombresDe(B));
      });
    });
  });
});
