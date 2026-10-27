// spec: 001-base-multitenancy (pruebas protegidas)
//
// P1 · Criterios 7, 8, 9 y 10: atributos de los roles, intentos de saltarse la RLS como
// `restaurante_api` y negativa a arrancar con un rol privilegiado.
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import {
  BASE_DE_PRUEBA,
  NOMBRES_DE_ROLES,
  abrirCliente,
  fijarEntornoDePrueba,
  urlDeRol,
} from '../utilidades';
import { crearEmpresaSql, enTransaccion, errorDe } from './fabrica';

const { api, plataforma, migrador } = NOMBRES_DE_ROLES;

describe('criterio 7 · atributos de los roles', () => {
  let admin: Client;
  beforeAll(async () => {
    admin = await abrirCliente('admin');
  });
  afterAll(async () => {
    await admin.end();
  });

  it.each([api, plataforma, migrador])('%s no es superusuario ni tiene BYPASSRLS', async (rol) => {
    const { rows } = await admin.query(
      'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
      [rol],
    );
    expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });

  it.each([api, plataforma])('%s no tiene CREATEROLE ni CREATEDB', async (rol) => {
    const { rows } = await admin.query(
      'SELECT rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1',
      [rol],
    );
    expect(rows).toEqual([{ rolcreaterole: false, rolcreatedb: false }]);
  });

  it.each([api, plataforma])('%s no es dueño de ninguna tabla ni función', async (rol) => {
    const tablas = await admin.query(
      `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
        WHERE r.rolname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
      [rol],
    );
    expect(tablas.rows).toEqual([]);
    const funciones = await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = $1`,
      [rol],
    );
    expect(funciones.rows).toEqual([]);
  });

  it('los roles de la API y de plataforma no son miembros de otro rol de la aplicación ni entre sí', async () => {
    const { rows } = await admin.query(
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
    expect(rows).toEqual([]);
  });
});

describe('criterios 8 y 9 · intentos de saltarse la RLS como restaurante_api', () => {
  let apiCliente: Client;
  let plataformaCliente: Client;
  beforeAll(async () => {
    apiCliente = await abrirCliente('api');
    plataformaCliente = await abrirCliente('plataforma');
  });
  afterAll(async () => {
    await apiCliente.end();
    await plataformaCliente.end();
  });

  // Cada sentencia corre sola (autocommit): un fallo no deja una transacción abortada.
  const prohibidas: [string, string][] = [
    [
      'ALTER TABLE ... DISABLE ROW LEVEL SECURITY',
      'ALTER TABLE sucursal DISABLE ROW LEVEL SECURITY',
    ],
    [
      'ALTER TABLE ... NO FORCE ROW LEVEL SECURITY',
      'ALTER TABLE sucursal NO FORCE ROW LEVEL SECURITY',
    ],
    ['DROP POLICY', 'DROP POLICY aislamiento_empresa ON sucursal'],
    [
      'CREATE POLICY',
      'CREATE POLICY abierta ON sucursal AS PERMISSIVE FOR ALL TO restaurante_api USING (true) WITH CHECK (true)',
    ],
    ['SET ROLE restaurante_migrador', 'SET ROLE restaurante_migrador'],
    ['TRUNCATE', 'TRUNCATE sucursal'],
    ['crear una tabla en public', 'CREATE TABLE public.tabla_prohibida (a integer)'],
    [
      'crear una función en public',
      'CREATE FUNCTION public.funcion_prohibida() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
    ],
    ['crear una tabla temporal', 'CREATE TEMPORARY TABLE tabla_temporal_prohibida (a integer)'],
  ];

  it.each(prohibidas)('criterio 8 · %s falla con un error de permisos', async (_nombre, sql) => {
    const error = await errorDe(apiCliente.query(sql));
    expect(error.code, `${sql} -> ${error.message}`).toBe('42501');
  });

  it('criterio 9 · con row_security = off, la consulta falla y no devuelve filas de ninguna empresa', async () => {
    const empresaA = await crearEmpresaSql(plataformaCliente);
    // Control: con la RLS activa y el contexto de A, la consulta devuelve las dos sucursales de A.
    const propias = await enTransaccion(apiCliente, empresaA.id, () =>
      apiCliente.query('SELECT id FROM sucursal'),
    );
    expect(propias.rows.map((f) => f.id).sort()).toEqual(
      empresaA.sucursales.map((s) => s.id).sort(),
    );

    const error = await errorDe(
      enTransaccion(apiCliente, empresaA.id, async () => {
        await apiCliente.query('SET row_security = off');
        return apiCliente.query('SELECT * FROM sucursal');
      }),
    );
    expect(error.code, error.message).toBe('42501');
  });
});

describe('criterio 10 · el arranque rechaza roles privilegiados', () => {
  const rolBypass = `prueba_bypass_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const contrasenaBypass = `pw_${randomUUID()}`;
  let admin: Client;
  let escrituras: ReturnType<typeof vi.spyOn>[] = [];

  beforeAll(async () => {
    admin = await abrirCliente('admin');
    const nombre = admin.escapeIdentifier(rolBypass);
    await admin.query(
      `CREATE ROLE ${nombre} LOGIN BYPASSRLS PASSWORD ${admin.escapeLiteral(contrasenaBypass)}`,
    );
    await admin.query(
      `GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(BASE_DE_PRUEBA)} TO ${nombre}`,
    );
  });

  afterAll(async () => {
    const nombre = admin.escapeIdentifier(rolBypass);
    try {
      await admin.query(
        `REVOKE ALL ON DATABASE ${admin.escapeIdentifier(BASE_DE_PRUEBA)} FROM ${nombre}`,
      );
    } finally {
      await admin.query(`DROP ROLE IF EXISTS ${nombre}`);
      await admin.end();
    }
  });

  afterEach(() => {
    for (const espia of escrituras) espia.mockRestore();
    escrituras = [];
  });

  function urlConRolBypass(): string {
    const url = new URL(urlDeRol('api'));
    url.username = rolBypass;
    url.password = contrasenaBypass;
    return url.toString();
  }

  /** Intenta arrancar la API; devuelve el texto del error y de lo que Nest escribió en el registro. */
  async function intentarArrancar(
    variable: 'DATABASE_URL' | 'DATABASE_PLATAFORMA_URL',
    url: string,
  ): Promise<string | null> {
    fijarEntornoDePrueba({ extra: { [variable]: url } });
    let registro = '';
    escrituras = [
      vi.spyOn(process.stdout, 'write').mockImplementation(((trozo: string | Uint8Array) => {
        registro += String(trozo);
        return true;
      }) as typeof process.stdout.write),
      vi.spyOn(process.stderr, 'write').mockImplementation(((trozo: string | Uint8Array) => {
        registro += String(trozo);
        return true;
      }) as typeof process.stderr.write),
    ];
    try {
      const app = await crearAplicacion({ logger: ['error', 'warn', 'log'] });
      await app.close();
      return null;
    } catch (error) {
      return `${error instanceof Error ? error.message : String(error)}\n${registro}`;
    } finally {
      for (const espia of escrituras) espia.mockRestore();
      escrituras = [];
      fijarEntornoDePrueba();
    }
  }

  const casos: {
    motivo: string;
    atributo: RegExp;
    url: () => string;
    rol: () => string;
  }[] = [
    {
      motivo: 'superusuario',
      atributo: /superusuario|superuser/i,
      url: () => urlDeRol('admin'),
      rol: () => decodeURIComponent(new URL(urlDeRol('admin')).username),
    },
    {
      motivo: 'BYPASSRLS',
      atributo: /bypassrls/i,
      url: urlConRolBypass,
      rol: () => rolBypass,
    },
    {
      motivo: 'dueño de una tabla de public',
      atributo: /due[ñn]o|owner|propietari/i,
      url: () => urlDeRol('migrador'),
      rol: () => NOMBRES_DE_ROLES.migrador,
    },
  ];

  for (const variable of ['DATABASE_URL', 'DATABASE_PLATAFORMA_URL'] as const) {
    it.each(casos)(
      `${variable} con un rol $motivo: no arranca y se indica rol y atributo`,
      async (caso) => {
        const texto = await intentarArrancar(variable, caso.url());
        expect(texto, 'la API arrancó con un rol privilegiado').not.toBeNull();
        expect(texto).toContain(caso.rol());
        expect(texto).toMatch(caso.atributo);
      },
    );
  }

  it('control · con los roles correctos la API sí arranca', async () => {
    const texto = await intentarArrancar('DATABASE_URL', urlDeRol('api'));
    expect(texto).toBeNull();
  });
});
