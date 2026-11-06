import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { RolPrivilegiadoError, verificarRolDeFacturacion } from '../../src/nucleo/base-de-datos';
import { conCliente, fijarEntornoDePrueba, urlDeRol } from '../utilidades';

// Pruebas del desarrollador (no protegidas) de los roles de 6b (historia 006, criterio 163 y "Permisos"):
// `restaurante_colas` y `restaurante_referencia` los crea `db:preparar` y se verifican al arrancar.

describe('db:preparar · roles y esquema de la facturación electrónica', () => {
  it('crea los dos roles sin atributos especiales y sin pertenecer a otros roles', async () => {
    await conCliente('admin', async (admin) => {
      const { rows } = await admin.query(
        `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin,
                (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid)::int AS membresias
           FROM pg_roles r WHERE rolname IN ('restaurante_colas', 'restaurante_referencia')
          ORDER BY rolname`,
      );
      expect(rows).toEqual([
        {
          rolname: 'restaurante_colas',
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolcanlogin: true,
          membresias: 0,
        },
        {
          rolname: 'restaurante_referencia',
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolcanlogin: true,
          membresias: 0,
        },
      ]);
    });
  });

  it('el esquema colas es del rol de la cola y nadie más tiene acceso', async () => {
    await conCliente('admin', async (admin) => {
      const { rows } = await admin.query(
        `SELECT pg_get_userbyid(nspowner) AS dueno, nspacl::text AS acl FROM pg_namespace WHERE nspname = 'colas'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].dueno).toBe('restaurante_colas');
      for (const rol of ['restaurante_api', 'restaurante_plataforma', 'restaurante_referencia']) {
        const { rows: acceso } = await admin.query(
          `SELECT has_schema_privilege($1, 'colas', 'USAGE') AS uso`,
          [rol],
        );
        expect(acceso[0].uso, rol).toBe(false);
      }
    });
  });

  it('el rol de la cola puede conectarse y crear en su esquema, pero no leer tablas de public', async () => {
    const cliente = new Client({ connectionString: urlDeRol('colas') });
    cliente.on('error', () => undefined);
    await cliente.connect();
    try {
      await cliente.query('CREATE TABLE colas.prueba_t29 (id int)');
      await cliente.query('DROP TABLE colas.prueba_t29');
      await expect(cliente.query('SELECT 1 FROM public.empresa LIMIT 1')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await cliente.end();
    }
  });

  it('el rol del padrón no tiene privilegios sobre las tablas de public ni sobre el esquema colas', async () => {
    const cliente = new Client({ connectionString: urlDeRol('referencia') });
    cliente.on('error', () => undefined);
    await cliente.connect();
    try {
      await expect(cliente.query('SELECT 1 FROM public.empresa LIMIT 1')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(cliente.query('CREATE TABLE colas.x (id int)')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await cliente.end();
    }
  });

  it('la API no puede leer ni crear nada en el esquema colas', async () => {
    const cliente = new Client({ connectionString: urlDeRol('api') });
    cliente.on('error', () => undefined);
    await cliente.connect();
    try {
      await expect(cliente.query('CREATE TABLE colas.x (id int)')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await cliente.end();
    }
  });
});

describe('verificación de los roles al arrancar', () => {
  it('los roles de la cola y del padrón pasan la verificación', async () => {
    await verificarRolDeFacturacion(urlDeRol('colas'), 'colas', 'DATABASE_COLAS_URL');
    await verificarRolDeFacturacion(
      urlDeRol('referencia'),
      'referencia',
      'DATABASE_REFERENCIA_URL',
    );
  });

  it('un rol privilegiado (el migrador o un superusuario) como cola o padrón se rechaza nombrando el consejo', async () => {
    for (const rol of ['migrador', 'admin'] as const) {
      const error = await verificarRolDeFacturacion(
        urlDeRol(rol),
        'colas',
        'DATABASE_COLAS_URL',
      ).catch((e: unknown) => e);
      expect(error, rol).toBeInstanceOf(RolPrivilegiadoError);
      expect((error as Error).message).toContain('restaurante_colas');
    }
  });
});

describe('la API verifica DATABASE_COLAS_URL al arrancar', () => {
  const abiertas: { close(): Promise<void> }[] = [];
  afterAll(async () => {
    for (const app of abiertas) await app.close().catch(() => undefined);
  });

  it('arranca con el rol de la cola y se niega a arrancar con un rol privilegiado', async () => {
    fijarEntornoDePrueba({ extra: { DATABASE_COLAS_URL: urlDeRol('colas') } });
    const app = await crearAplicacion();
    abiertas.push(app);
    await app.close();

    fijarEntornoDePrueba({ extra: { DATABASE_COLAS_URL: urlDeRol('migrador') } });
    await expect(crearAplicacion()).rejects.toBeInstanceOf(RolPrivilegiadoError);
  });
});
