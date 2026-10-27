// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 38e, incisos (a), (b), (c) y (e): `db:preparar` con PostgreSQL administrado, sin superusuario.
// Se prueba la función pública `prepararBaseDeDatos` (`apps/api/scripts/lib/preparar-bd.ts`, lo que corre
// `pnpm db:preparar`) con un administrador que NO es superusuario, creado aquí con el superusuario de las
// pruebas: `LOGIN CREATEROLE CREATEDB NOSUPERUSER`, dueño de nada en `pg_catalog`, con `ADMIN OPTION` sobre los
// tres roles de la aplicación (como el administrador de un PostgreSQL administrado que los creó), y una
// base de nombre aleatorio.
// - Sin `DB_PROTECCION_CATALOGO`: falla antes de crear nada, con un mensaje que contiene
//   `DB_PROTECCION_CATALOGO=omitir` y nombra 38b, 38c, 38d y 22d; la base no existe.
// - Con un valor inválido: falla nombrando la variable y `omitir`, con o sin superusuario; no crea la base.
// - Con `omitir`: termina bien, avisa (38b, 38c, 38d, 22d y la guarda de la API), se puede repetir, los roles
//   cumplen el criterio 7, las migraciones corren con el migrador y el aislamiento entre empresas sigue
//   intacto (criterio 22e) en esa base.
// - Con superusuario y `omitir`: las protecciones del catálogo se aplican igual y no hay aviso de omisión.
// Los roles `restaurante_*` son de clúster y los usa la suite en paralelo: aquí no se borran ni se les
// cambian las contraseñas (se usan las de prueba). Al terminar se borran las bases y el rol temporales.
import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrarArriba } from '../../scripts/lib/migraciones';
import { prepararBaseDeDatos } from '../../scripts/lib/preparar-bd';
import { exigirUrlAdmin } from '../../scripts/lib/roles';
import { NOMBRES_DE_ROLES, abrirCliente, urlDeRol } from '../utilidades';
import {
  comenzar,
  crearEmpresaSql,
  errorDe,
  exigirContextoAusente,
  rucAleatorio,
  textoUnico,
} from './fabrica';

const sufijo = randomBytes(5).toString('hex');
const ROL_ADMIN = `adm_sin_su_${sufijo}`;
const CLAVE_ADMIN = `clave_${randomUUID().replace(/-/g, '')}`;
const { migrador, api, plataforma } = NOMBRES_DE_ROLES;

const basesCreadas: string[] = [];
/** Nombre de base aleatorio y único; se borra al terminar. */
function baseNueva(etiqueta: string): string {
  const nombre = `rest_${etiqueta}_${sufijo}_${randomBytes(2).toString('hex')}`;
  basesCreadas.push(nombre);
  return nombre;
}

let superusuario: Client;

/** URL del administrador sin superusuario (mismo servidor y base de conexión que `DATABASE_ADMIN_URL`). */
function urlDelAdministradorSinSuperusuario(): string {
  const url = new URL(exigirUrlAdmin());
  url.username = ROL_ADMIN;
  url.password = CLAVE_ADMIN;
  return url.toString();
}

/** Entorno de `prepararBaseDeDatos`: NODE_ENV=test, las contraseñas de prueba y la variable indicada. */
function entorno(proteccion: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test' };
  delete env.DB_PROTECCION_CATALOGO;
  if (proteccion !== undefined) env.DB_PROTECCION_CATALOGO = proteccion;
  return env;
}

/**
 * Los roles de clúster los modifica `db:preparar` y lo hacen también otros archivos de la suite en paralelo:
 * PostgreSQL puede responder "tuple concurrently updated" a dos `ALTER ROLE` simultáneos. Solo en las
 * ejecuciones que deben salir bien se reintenta por ese motivo; cualquier otro error se propaga.
 */
async function conReintento<T>(trabajo: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await trabajo();
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      if (intento >= 5 || !/tuple concurrently updated|deadlock detected/i.test(mensaje)) {
        throw error;
      }
      await new Promise((resolver) => setTimeout(resolver, 200 * intento));
    }
  }
}

async function existeLaBase(nombre: string): Promise<boolean> {
  const { rows } = await superusuario.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    nombre,
  ]);
  return rows.length > 0;
}

beforeAll(async () => {
  superusuario = await abrirCliente('admin');
  await superusuario.query(
    `CREATE ROLE "${ROL_ADMIN}" LOGIN PASSWORD '${CLAVE_ADMIN}' CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS NOREPLICATION`,
  );
  await superusuario.query(
    `GRANT "${migrador}", "${api}", "${plataforma}" TO "${ROL_ADMIN}" WITH ADMIN OPTION`,
  );
  // Condición del escenario: dueño de nada en pg_catalog y sin ser superusuario.
  const { rows } = await superusuario.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
    `SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = $1`,
    [ROL_ADMIN],
  );
  expect(rows[0]).toEqual({ rolsuper: false, rolcreaterole: true });
});

afterAll(async () => {
  if (superusuario === undefined) return;
  try {
    for (const base of basesCreadas) {
      await superusuario.query(`DROP DATABASE IF EXISTS "${base}" WITH (FORCE)`);
    }
    await superusuario.query(`DROP OWNED BY "${ROL_ADMIN}"`).catch(() => undefined);
    await superusuario.query(`DROP ROLE IF EXISTS "${ROL_ADMIN}"`);
  } finally {
    await superusuario.end();
  }
});

// --------------------------------------------------------------------------------------------------
// (a) y (b) Sin opción explícita
// --------------------------------------------------------------------------------------------------
describe('criterio 38e (b) · administrador sin superusuario y sin DB_PROTECCION_CATALOGO', () => {
  it.each([
    ['sin definir', undefined],
    ['vacía', ''],
  ])(
    'con la variable %s, prepararBaseDeDatos falla antes de crear la base, nombra 38b, 38c, 38d y 22d y explica omitir',
    async (_nombre, valor) => {
      const base = baseNueva('sinvar');
      const avisos: string[] = [];
      const error = await prepararBaseDeDatos({
        adminUrl: urlDelAdministradorSinSuperusuario(),
        baseDeDatos: base,
        env: entorno(valor),
        avisar: (mensaje: string) => avisos.push(mensaje),
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, 'prepararBaseDeDatos debía fallar').toBeInstanceOf(Error);
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('DB_PROTECCION_CATALOGO=omitir');
      for (const criterio of ['38b', '38c', '38d', '22d']) {
        expect(mensaje, `el mensaje debe nombrar el criterio ${criterio}`).toContain(criterio);
      }
      expect(mensaje).toMatch(/guarda/i);
      expect(await existeLaBase(base), 'la base de destino no debe haberse creado').toBe(false);
      expect(avisos, 'si falla no hay aviso de omisión').toEqual([]);
    },
  );
});

describe('criterio 38e (c) · valor inválido de DB_PROTECCION_CATALOGO', () => {
  it.each(['omitirr', 'OMITIR', 'Omitir', '1', 'true'])(
    'con %j y un administrador sin superusuario falla nombrando la variable y su único valor válido, sin crear la base',
    async (valor) => {
      const base = baseNueva('invalido');
      const error = await prepararBaseDeDatos({
        adminUrl: urlDelAdministradorSinSuperusuario(),
        baseDeDatos: base,
        env: entorno(valor),
        avisar: () => undefined,
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, 'prepararBaseDeDatos debía fallar').toBeInstanceOf(Error);
      expect((error as Error).message).toContain('DB_PROTECCION_CATALOGO');
      expect((error as Error).message).toContain('omitir');
      expect(await existeLaBase(base)).toBe(false);
    },
  );

  it.each(['omitirr', 'OMITIR'])(
    'con %j y el superusuario de las pruebas también falla antes de crear nada',
    async (valor) => {
      const base = baseNueva('invalidosu');
      const error = await prepararBaseDeDatos({
        baseDeDatos: base,
        env: entorno(valor),
        avisar: () => undefined,
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, 'prepararBaseDeDatos debía fallar').toBeInstanceOf(Error);
      expect((error as Error).message).toContain('DB_PROTECCION_CATALOGO');
      expect((error as Error).message).toContain('omitir');
      expect(await existeLaBase(base)).toBe(false);
    },
  );
});

// --------------------------------------------------------------------------------------------------
// (c) Con DB_PROTECCION_CATALOGO=omitir
// --------------------------------------------------------------------------------------------------
describe('criterio 38e (c, e) · administrador sin superusuario con DB_PROTECCION_CATALOGO=omitir', () => {
  const base = baseNueva('omitir');
  const avisos: string[] = [];
  const avisosDeLaSegunda: string[] = [];
  let clienteApi: Client | undefined;
  let clientePlataforma: Client | undefined;

  const preparar = (recoger: string[]) =>
    conReintento(() =>
      prepararBaseDeDatos({
        adminUrl: urlDelAdministradorSinSuperusuario(),
        baseDeDatos: base,
        env: entorno('omitir'),
        avisar: (mensaje: string) => recoger.push(mensaje),
      }),
    );

  afterAll(async () => {
    await clienteApi?.end().catch(() => undefined);
    await clientePlataforma?.end().catch(() => undefined);
  });

  it('termina bien y avisa: nombra 38b, 38c, 38d y 22d, y que esas protecciones quedan solo en la guarda de la API', async () => {
    await preparar(avisos);
    expect(await existeLaBase(base)).toBe(true);
    const aviso = avisos.join('\n');
    expect(avisos.length, 'debe haber un aviso').toBeGreaterThan(0);
    for (const criterio of ['38b', '38c', '38d', '22d']) {
      expect(aviso, `el aviso debe nombrar el criterio ${criterio}`).toContain(criterio);
    }
    expect(aviso).toMatch(/guarda de la API/i);
  });

  it('ejecutarlo otra vez no falla y vuelve a avisar', async () => {
    await preparar(avisosDeLaSegunda);
    expect(avisosDeLaSegunda.join('\n')).toContain('38b');
  });

  it('la base es del migrador, PUBLIC no tiene privilegios y api y plataforma pueden conectarse', async () => {
    const { rows } = await superusuario.query<{
      dueno: string;
      api: boolean;
      plataforma: boolean;
      publico: number;
    }>(
      `SELECT pg_get_userbyid(d.datdba) AS dueno,
              has_database_privilege($2, d.datname, 'CONNECT') AS api,
              has_database_privilege($3, d.datname, 'CONNECT') AS plataforma,
              (SELECT count(*)::int FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
                WHERE a.grantee = 0) AS publico
         FROM pg_database d WHERE d.datname = $1`,
      [base, api, plataforma],
    );
    expect(rows[0]).toEqual({ dueno: migrador, api: true, plataforma: true, publico: 0 });
  });

  it('los roles siguen cumpliendo el criterio 7', async () => {
    const atributos = await superusuario.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[migrador, api, plataforma]],
    );
    expect(atributos.rows.map((r) => r.rolname)).toEqual([api, migrador, plataforma].sort());
    for (const rol of atributos.rows) {
      expect(rol.rolsuper, `${rol.rolname} es superusuario`).toBe(false);
      expect(rol.rolbypassrls, `${rol.rolname} tiene BYPASSRLS`).toBe(false);
      expect(rol.rolcanlogin).toBe(true);
      if (rol.rolname !== migrador) {
        expect(rol.rolcreaterole, `${rol.rolname} tiene CREATEROLE`).toBe(false);
        expect(rol.rolcreatedb, `${rol.rolname} tiene CREATEDB`).toBe(false);
      }
    }
    const membresias = await superusuario.query(
      `SELECT miembro.rolname AS miembro, grupo.rolname AS grupo
         FROM pg_auth_members m
         JOIN pg_roles miembro ON miembro.oid = m.member
         JOIN pg_roles grupo ON grupo.oid = m.roleid
        WHERE miembro.rolname = ANY($1) AND grupo.rolname = ANY($2)`,
      [
        [api, plataforma],
        [api, plataforma, migrador],
      ],
    );
    expect(membresias.rows).toEqual([]);
  });

  it('los roles de la aplicación se conectan a la base nueva con las contraseñas de prueba', async () => {
    clienteApi = await abrirCliente('api', base);
    clientePlataforma = await abrirCliente('plataforma', base);
    const migradorCliente = await abrirCliente('migrador', base);
    try {
      const { rows } = await migradorCliente.query('SELECT current_user AS u');
      expect(rows[0].u).toBe(migrador);
    } finally {
      await migradorCliente.end();
    }
  });

  it('db:migrar sobre esa base termina sin errores y es repetible', async () => {
    const aplicadas = await migrarArriba(urlDeRol('migrador', base));
    expect(aplicadas.length, 'se esperaba aplicar las migraciones').toBeGreaterThan(0);
    expect(aplicadas).toContain('202610270001-plataforma-base.ts');
    expect(await migrarArriba(urlDeRol('migrador', base))).toEqual([]);
  });

  describe('el aislamiento entre empresas sigue intacto en esa base (criterio 22e, incisos a y b)', () => {
    let A: Awaited<ReturnType<typeof crearEmpresaSql>>;
    let B: Awaited<ReturnType<typeof crearEmpresaSql>>;
    const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();

    beforeAll(async () => {
      clienteApi ??= await abrirCliente('api', base);
      clientePlataforma ??= await abrirCliente('plataforma', base);
      A = await crearEmpresaSql(clientePlataforma);
      B = await crearEmpresaSql(clientePlataforma);
    });

    it('con fijar_contexto_empresa(A) solo se ven filas de A en empresa, emisor y sucursal', async () => {
      const c = clienteApi!;
      await comenzar(c);
      try {
        await c.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        expect(ids((await c.query('SELECT id FROM empresa')).rows)).toEqual([A.id]);
        expect(ids((await c.query('SELECT id FROM emisor')).rows)).toEqual(ids(A.emisores));
        expect(ids((await c.query('SELECT id FROM sucursal')).rows)).toEqual(ids(A.sucursales));
      } finally {
        await c.query('ROLLBACK');
      }
    });

    it('UPDATE y DELETE de filas de B por id afectan 0 filas e INSERT con empresa_id de B falla', async () => {
      const c = clienteApi!;
      await comenzar(c);
      try {
        await c.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        const actualizadas = await c.query('UPDATE sucursal SET direccion = $1 WHERE id = $2', [
          'Hackeada',
          B.sucursales[0]!.id,
        ]);
        expect(actualizadas.rowCount).toBe(0);
        const borradas = await c.query('DELETE FROM sucursal WHERE id = $1', [B.sucursales[0]!.id]);
        expect(borradas.rowCount).toBe(0);
        await c.query('SAVEPOINT insercion');
        const emisor = await errorDe(
          c.query(
            `INSERT INTO emisor (empresa_id, ruc, razon_social, regimen, creado_en, actualizado_en)
             VALUES ($1, $2, 'Intruso SAC', 'GENERAL', now(), now())`,
            [B.id, rucAleatorio()],
          ),
        );
        expect(emisor.code, emisor.message).toBe('42501');
        // Con el actor fijado, el rechazo es el de la política RLS (criterio 115).
        expect(emisor.message).toMatch(/row-level security/);
        await c.query('ROLLBACK TO SAVEPOINT insercion');
        const sucursal = await errorDe(
          c.query(
            `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
             VALUES ($1, $2, $3, '0099', 'Calle falsa 1', now(), now())`,
            [B.id, B.emisores[0]!.id, textoUnico('Intrusa')],
          ),
        );
        expect(sucursal.code, sucursal.message).toBe('42501');
        expect(sucursal.message).toMatch(/row-level security/);
      } finally {
        await c.query('ROLLBACK');
      }
      const { rows } = await clientePlataforma!.query(
        'SELECT direccion FROM sucursal WHERE id = $1',
        [B.sucursales[0]!.id],
      );
      expect(rows[0].direccion).not.toBe('Hackeada');
    });

    it('sin contexto, las sentencias del criterio 19 fallan con "contexto de empresa ausente"', async () => {
      const c = clienteApi!;
      await exigirContextoAusente(c, A.id);
      await comenzar(c);
      try {
        await exigirContextoAusente(c, A.id, { enTransaccionAbierta: true });
      } finally {
        await c.query('ROLLBACK');
      }
    });

    it('set_config("app.empresa_id", B) no cambia empresa_actual() y una segunda fijación falla con "contexto de empresa ya fijado"', async () => {
      const c = clienteApi!;
      await comenzar(c);
      try {
        await c.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        await c.query(`SELECT set_config('app.empresa_id', $1, true)`, [B.id]);
        expect((await c.query('SELECT empresa_actual()::text AS id')).rows[0].id).toBe(A.id);
        expect(ids((await c.query('SELECT id FROM sucursal')).rows)).toEqual(ids(A.sucursales));
        await c.query('SAVEPOINT segunda');
        for (const empresa of [B.id, A.id]) {
          const error = await errorDe(c.query('SELECT fijar_contexto_empresa($1)', [empresa]));
          expect(error.code, error.message).toBe('42501');
          expect(error.message).toMatch(/^contexto de empresa ya fijado/);
          await c.query('ROLLBACK TO SAVEPOINT segunda');
        }
        expect((await c.query('SELECT empresa_actual()::text AS id')).rows[0].id).toBe(A.id);
      } finally {
        await c.query('ROLLBACK');
      }
    });

    it('la fijación muere con la transacción: otra transacción de la misma conexión fija B y solo ve B', async () => {
      const c = clienteApi!;
      await comenzar(c);
      await c.query('SELECT fijar_contexto_empresa($1)', [A.id]);
      await c.query('COMMIT');
      await exigirContextoAusente(c, A.id);
      await comenzar(c);
      try {
        await c.query('SELECT fijar_contexto_empresa($1)', [B.id]);
        expect(ids((await c.query('SELECT id FROM sucursal')).rows)).toEqual(ids(B.sucursales));
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });
});

// --------------------------------------------------------------------------------------------------
// (a) y (e) Con superusuario: omitir no cambia nada
// --------------------------------------------------------------------------------------------------
describe('criterio 38e (a, e) · superusuario con DB_PROTECCION_CATALOGO=omitir', () => {
  const base = baseNueva('super');
  const avisos: string[] = [];

  it('prepararBaseDeDatos termina bien y no escribe el aviso de omisión', async () => {
    await conReintento(() =>
      prepararBaseDeDatos({
        baseDeDatos: base,
        env: entorno('omitir'),
        avisar: (mensaje: string) => avisos.push(mensaje),
      }),
    );
    expect(await existeLaBase(base)).toBe(true);
    expect(avisos.join('\n')).not.toMatch(/38b|38c|38d|omit/i);
  });

  it('las protecciones del catálogo quedan aplicadas igual (muestreo por rol)', async () => {
    const cliente = await abrirCliente('admin', base);
    try {
      for (const rol of [api, plataforma]) {
        const { rows } = await cliente.query<Record<string, boolean>>(
          `SELECT has_function_privilege($1, 'lo_get(oid)', 'EXECUTE') AS lo_get,
                  has_table_privilege($1, 'pg_catalog.pg_stat_activity', 'SELECT') AS actividad,
                  has_function_privilege($1, 'pg_cancel_backend(integer)', 'EXECUTE') AS cancelar,
                  has_function_privilege($1, 'pg_terminate_backend(integer,bigint)', 'EXECUTE') AS terminar,
                  has_table_privilege($1, 'pg_catalog.pg_largeobject_metadata', 'SELECT') AS lo_meta,
                  has_table_privilege($1, 'pg_catalog.pg_settings', 'UPDATE') AS ajustes`,
          [rol],
        );
        expect(rows[0], rol).toEqual({
          lo_get: false,
          actividad: false,
          cancelar: false,
          terminar: false,
          lo_meta: false,
          ajustes: false,
        });
        const firmas = await cliente.query<{ firma: string }>(
          `SELECT p.oid::regprocedure::text AS firma
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'pg_catalog' AND p.proname IN ('ts_rewrite', 'ts_stat', 'query_to_xml')
              AND has_function_privilege($1, p.oid, 'EXECUTE')`,
          [rol],
        );
        expect(
          firmas.rows.map((f) => f.firma),
          `${rol}: firmas ejecutables`,
        ).toEqual([]);
      }
    } finally {
      await cliente.end();
    }
  });

  it('el rol de la aplicación tampoco puede leer pg_stat_activity ni llamar lo_get en esa base', async () => {
    const cliente = await abrirCliente('api', base);
    try {
      for (const sql of ['SELECT query FROM pg_stat_activity', 'SELECT lo_get(1)']) {
        const error = await errorDe(cliente.query(sql));
        expect(error.code, `${sql}: ${error.message}`).toBe('42501');
      }
    } finally {
      await cliente.end();
    }
  });

  it('sin DB_PROTECCION_CATALOGO y con superusuario, volver a preparar termina bien', async () => {
    const avisosSinVariable: string[] = [];
    await conReintento(() =>
      prepararBaseDeDatos({
        baseDeDatos: base,
        env: entorno(undefined),
        avisar: (mensaje: string) => avisosSinVariable.push(mensaje),
      }),
    );
    expect(avisosSinVariable.join('\n')).not.toMatch(/38b|38c|38d|omit/i);
  });
});
