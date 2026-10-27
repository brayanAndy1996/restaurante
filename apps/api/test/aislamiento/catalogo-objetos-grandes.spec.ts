// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 38d (falla de la ronda 3 del adversarial): los objetos grandes (large objects) de PostgreSQL
// no tienen RLS ni `empresa_id`, y todas las conexiones de la API comparten el rol `restaurante_api`.
// Si ese rol pudiera crearlos, leerlos, escribirlos o borrarlos, servirían para pasar datos entre
// empresas. Esperado: `restaurante_api` (con o sin contexto) y `restaurante_plataforma` reciben
// permiso denegado (42501) en cada intento, aun siendo dueños del objeto (peor caso), y en el catálogo
// no tienen EXECUTE sobre `lo_*`, `loread` ni `lowrite`, ni SELECT sobre `pg_largeobject` y
// `pg_largeobject_metadata`.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { DatabaseError, type Sequelize } from 'sequelize';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { NOMBRES_DE_ROLES, abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, enTransaccion, errorDe, type EmpresaSql } from './fabrica';

let admin: Client;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;
let app: INestApplication;

beforeAll(async () => {
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
});

afterAll(async () => {
  // Si hoy algún intento llegara a crear un objeto grande (y confirmarlo), no debe quedar en la base.
  await admin
    ?.query(
      `SELECT lo_unlink(m.oid) FROM pg_largeobject_metadata m
        WHERE m.lomowner IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1))`,
      [[NOMBRES_DE_ROLES.api, NOMBRES_DE_ROLES.plataforma]],
    )
    .catch(() => undefined);
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

const SECRETO = 'SECRETO';
type RolApp = 'api' | 'plataforma';
const ROLES_APP: RolApp[] = ['api', 'plataforma'];
const PERMISO_DENEGADO = '42501';

/** Objetos que cada prueba crea con el administrador y borra al terminar. */
let creados: number[] = [];

/** Crea un objeto grande con el administrador y lo deja a nombre de `rol` (el peor caso). */
async function crearObjeto(rol: RolApp): Promise<number> {
  const { rows } = await admin.query<{ oid: string }>(
    `SELECT lo_from_bytea(0, convert_to($1, 'UTF8')) AS oid`,
    [SECRETO],
  );
  const oid = Number(rows[0]!.oid);
  creados.push(oid);
  await admin.query(`ALTER LARGE OBJECT ${oid} OWNER TO ${NOMBRES_DE_ROLES[rol]}`);
  return oid;
}

const existe = async (oid: number) =>
  (await admin.query('SELECT 1 FROM pg_largeobject_metadata WHERE oid = $1', [oid])).rowCount === 1;

afterEach(async () => {
  for (const oid of creados)
    await admin.query('SELECT lo_unlink($1)', [oid]).catch(() => undefined);
  creados = [];
});

/** Corre `sql` como `rol` (con la empresa indicada o sin contexto) y devuelve el error de PostgreSQL. */
async function intentar(rol: RolApp, empresa: EmpresaSql | null, sql: string, params: unknown[]) {
  const cliente = await abrirCliente(rol);
  try {
    return await errorDe(
      enTransaccion(cliente, empresa?.id ?? null, () => cliente.query(sql, params)),
    );
  } finally {
    await cliente.end();
  }
}

/** Sentencias que operan sobre un objeto existente (`$1` es su oid). */
const SOBRE_OBJETO: { nombre: string; sql: string }[] = [
  { nombre: 'lo_get(oid)', sql: 'SELECT lo_get($1::oid)' },
  { nombre: 'lo_get(oid, desplazamiento, largo)', sql: 'SELECT lo_get($1::oid, 0, 3)' },
  { nombre: 'lo_put(oid, 0, datos)', sql: `SELECT lo_put($1::oid, 0, '\\x41'::bytea)` },
  { nombre: 'lo_unlink(oid)', sql: 'SELECT lo_unlink($1::oid)' },
  { nombre: 'lo_open(oid, lectura)', sql: 'SELECT lo_open($1::oid, 262144)' },
  { nombre: 'lo_open(oid, escritura)', sql: 'SELECT lo_open($1::oid, 131072)' },
  {
    nombre: 'lo_truncate sobre un descriptor abierto',
    sql: 'SELECT lo_truncate(lo_open($1::oid, 131072), 0)',
  },
  { nombre: 'lo_export(oid, ruta)', sql: `SELECT lo_export($1::oid, '/tmp/objeto-grande-prueba')` },
  {
    nombre: 'lo_from_bytea(oid existente, datos)',
    sql: `SELECT lo_from_bytea($1::oid, 'x'::bytea)`,
  },
];

/** Sentencias que no necesitan un objeto previo. */
const SIN_OBJETO: { nombre: string; sql: string }[] = [
  {
    nombre: 'lo_from_bytea(0, datos)',
    sql: `SELECT lo_from_bytea(0, convert_to('${SECRETO}','UTF8'))`,
  },
  { nombre: 'lo_create(0)', sql: 'SELECT lo_create(0)' },
  { nombre: 'lo_creat(-1)', sql: 'SELECT lo_creat(-1)' },
  { nombre: 'lo_import(ruta)', sql: `SELECT lo_import('/etc/hostname')` },
  { nombre: 'loread(0, 10)', sql: 'SELECT loread(0, 10)' },
  { nombre: 'lowrite(0, datos)', sql: `SELECT lowrite(0, 'x'::bytea)` },
  { nombre: 'lo_lseek(0, 0, 0)', sql: 'SELECT lo_lseek(0, 0, 0)' },
  { nombre: 'lo_lseek64(0, 0, 0)', sql: 'SELECT lo_lseek64(0, 0, 0)' },
  { nombre: 'lo_tell(0)', sql: 'SELECT lo_tell(0)' },
  { nombre: 'lo_tell64(0)', sql: 'SELECT lo_tell64(0)' },
  { nombre: 'lo_close(0)', sql: 'SELECT lo_close(0)' },
  { nombre: 'lo_truncate(0, 0)', sql: 'SELECT lo_truncate(0, 0)' },
  { nombre: 'lo_truncate64(0, 0)', sql: 'SELECT lo_truncate64(0, 0)' },
  {
    nombre: 'SELECT count(*) FROM pg_largeobject_metadata',
    sql: 'SELECT count(*) FROM pg_largeobject_metadata',
  },
  { nombre: 'SELECT count(*) FROM pg_largeobject', sql: 'SELECT count(*) FROM pg_largeobject' },
];

describe.each(ROLES_APP)('criterio 38d · %s no puede usar objetos grandes', (rol) => {
  // `restaurante_api` se prueba con la empresa B, con la A y sin contexto; plataforma, sin contexto.
  const CONTEXTOS: { nombre: string; empresa: () => EmpresaSql | null }[] =
    rol === 'api'
      ? [
          { nombre: 'con contexto de B', empresa: () => B },
          { nombre: 'con contexto de A', empresa: () => A },
          { nombre: 'sin contexto', empresa: () => null },
        ]
      : [{ nombre: 'sin contexto', empresa: () => null }];

  describe.each(CONTEXTOS)('$nombre', ({ empresa }) => {
    it.each(SIN_OBJETO)('$nombre falla con permiso denegado (42501)', async ({ sql }) => {
      const error = await intentar(rol, empresa(), sql, []);
      expect(error.code, error.message).toBe(PERMISO_DENEGADO);
    });

    describe('sobre un objeto existente de su propiedad (peor caso)', () => {
      let oid: number;
      beforeEach(async () => {
        oid = await crearObjeto(rol);
      });

      it.each(SOBRE_OBJETO)('$nombre falla con permiso denegado (42501)', async ({ sql }) => {
        const error = await intentar(rol, empresa(), sql, [oid]);
        expect(error.code, error.message).toBe(PERMISO_DENEGADO);
      });
    });
  });

  it('un objeto creado por el administrador y asignado a otra sesión del mismo rol no se puede leer', async () => {
    // Una sesión del rol con contexto de B intenta leer; otra sesión con contexto de A también.
    const oid = await crearObjeto(rol);
    const deB = await intentar(rol, rol === 'api' ? B : null, 'SELECT lo_get($1::oid)', [oid]);
    const deA = await intentar(rol, rol === 'api' ? A : null, 'SELECT lo_get($1::oid)', [oid]);
    expect(deB.code, deB.message).toBe(PERMISO_DENEGADO);
    expect(deA.code, deA.message).toBe(PERMISO_DENEGADO);
  });
});

describe('criterio 38d · por la conexión de la API (ContextoEmpresa.ejecutar)', () => {
  const codigoDe = (error: unknown): string | undefined => {
    const e = error as { original?: { code?: string }; parent?: { code?: string }; code?: string };
    return e.original?.code ?? e.parent?.code ?? e.code;
  };

  /**
   * Desde el criterio 38e (d), la guarda de la API rechaza estos nombres antes de llegar a la base con un
   * error que no es `DatabaseError` (`ConsultaProhibidaError`); si la consulta llegara a la base, esta debe
   * negarla con 42501. Nunca puede tener éxito.
   */
  const exigirRechazo = (error: unknown, sql: string): void => {
    const detalle = `${sql}: ${error instanceof Error ? error.message : String(error)}`;
    expect(error, `${sql} no debía funcionar`).toBeDefined();
    expect(error, detalle).toBeInstanceOf(Error);
    if (error instanceof DatabaseError) {
      expect(codigoDe(error), detalle).toBe(PERMISO_DENEGADO);
    }
    // Si no es `DatabaseError`, la rechazó la guarda de la API antes de la base.
  };

  it.each([
    ['lo_get', (oid: number) => `SELECT lo_get(${oid})`],
    ['lo_put', (oid: number) => `SELECT lo_put(${oid}, 0, '\\x41'::bytea)`],
    ['lo_unlink', (oid: number) => `SELECT lo_unlink(${oid})`],
    ['lo_open', (oid: number) => `SELECT lo_open(${oid}, 262144)`],
  ])('%s sobre un objeto de su propiedad se rechaza (guarda o 42501)', async (_n, sqlDe) => {
    const oid = await crearObjeto('api');
    const sequelize = app.get<Sequelize>(CONEXION_API);
    const error = await app
      .get(ContextoEmpresa)
      .ejecutar(A.id, () => sequelize.query(sqlDe(oid)))
      .then(
        () => undefined,
        (e: unknown) => e ?? new Error('error vacío'),
      );
    exigirRechazo(error, sqlDe(oid));
    expect(await existe(oid)).toBe(true);
  });

  it('lo_from_bytea(0, …) y SELECT sobre pg_largeobject_metadata se rechazan (guarda o 42501)', async () => {
    const sequelize = app.get<Sequelize>(CONEXION_API);
    for (const sql of [
      `SELECT lo_from_bytea(0, convert_to('${SECRETO}','UTF8'))`,
      'SELECT count(*) FROM pg_largeobject_metadata',
    ]) {
      const error = await app
        .get(ContextoEmpresa)
        .ejecutar(A.id, () => sequelize.query(sql))
        .then(
          () => undefined,
          (e: unknown) => e ?? new Error('error vacío'),
        );
      exigirRechazo(error, sql);
    }
  });
});

describe.each(ROLES_APP)('criterio 38d · catálogo: %s', (rol) => {
  const nombreDelRol = () => NOMBRES_DE_ROLES[rol];

  it('no tiene EXECUTE sobre ninguna función de pg_catalog cuyo nombre empiece con lo_, ni sobre loread o lowrite', async () => {
    const { rows } = await admin.query<{ firma: string }>(
      `SELECT p.oid::regprocedure::text AS firma
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pg_catalog'
          AND (p.proname LIKE 'lo\\_%' OR p.proname IN ('loread', 'lowrite'))
          AND has_function_privilege($1, p.oid, 'EXECUTE')
        ORDER BY 1`,
      [nombreDelRol()],
    );
    expect(rows.map((r) => r.firma)).toEqual([]);
  });

  it('el catálogo sí contiene esas funciones (la comprobación no es vacía)', async () => {
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pg_catalog' AND (p.proname LIKE 'lo\\_%' OR p.proname IN ('loread', 'lowrite'))`,
    );
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(10);
  });

  it('no tiene SELECT sobre pg_largeobject ni pg_largeobject_metadata', async () => {
    const { rows } = await admin.query<{ tabla: string; select: boolean }>(
      `SELECT t AS tabla, has_table_privilege($1, t, 'SELECT') AS "select"
         FROM unnest(ARRAY['pg_catalog.pg_largeobject', 'pg_catalog.pg_largeobject_metadata']) AS t`,
      [nombreDelRol()],
    );
    expect(rows.filter((r) => r.select).map((r) => r.tabla)).toEqual([]);
  });
});
