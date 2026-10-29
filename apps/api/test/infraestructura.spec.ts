import { join } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { migrarArriba, revertirUltima } from '../scripts/lib/migraciones';
import { prepararBaseDeDatos } from '../scripts/lib/preparar-bd';
import { BASE_DE_PRUEBA, abrirCliente, conCliente, urlDeRol } from './utilidades';

// Pruebas de humo de la infraestructura de pruebas (no son las pruebas protegidas de aislamiento).

describe('preparación de la base de pruebas', () => {
  it('los roles existen con los atributos mínimos', async () => {
    await conCliente('admin', async (admin) => {
      const { rows } = await admin.query(
        `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin, rolinherit
           FROM pg_roles WHERE rolname LIKE 'restaurante\\_%' ORDER BY rolname`,
      );
      expect(rows.map((r) => r.rolname)).toEqual([
        'restaurante_api',
        'restaurante_migrador',
        'restaurante_plataforma',
        'restaurante_tiempo_real',
      ]);
      for (const rol of rows) {
        expect(rol).toMatchObject({
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolcanlogin: true,
          rolinherit: false,
        });
      }
    });
  });

  it('la base de pruebas es del migrador y PUBLIC no tiene privilegios', async () => {
    await conCliente('admin', async (admin) => {
      const { rows } = await admin.query(
        `SELECT pg_get_userbyid(datdba) AS dueno, datacl::text AS acl FROM pg_database WHERE datname = $1`,
        [BASE_DE_PRUEBA],
      );
      expect(rows[0].dueno).toBe('restaurante_migrador');
      // Sin una entrada "=..." (PUBLIC) y con CONNECT para api y plataforma.
      expect(rows[0].acl).not.toMatch(/(^|[{,"])=/);
      expect(rows[0].acl).toMatch(/restaurante_api=c\//);
      expect(rows[0].acl).toMatch(/restaurante_plataforma=c\//);
    });
  });

  it('cada rol puede conectarse a restaurante_test', async () => {
    for (const rol of ['migrador', 'api', 'plataforma'] as const) {
      const cliente = await abrirCliente(rol);
      try {
        const { rows } = await cliente.query('SELECT current_user AS usuario');
        expect(rows[0].usuario).toBe(`restaurante_${rol}`);
      } finally {
        await cliente.end();
      }
    }
  });

  it('el rol de la API tiene idle_in_transaction_session_timeout de 30 s', async () => {
    await conCliente('api', async (api) => {
      const { rows } = await api.query('SHOW idle_in_transaction_session_timeout');
      expect(rows[0].idle_in_transaction_session_timeout).toBe('30s');
    });
  });

  it('las migraciones corrieron como migrador (la tabla migraciones es del migrador)', async () => {
    await conCliente('migrador', async (migrador) => {
      const { rows } = await migrador.query(
        `SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'migraciones'`,
      );
      expect(rows[0]?.tableowner).toBe('restaurante_migrador');
    });
  });
});

describe('scripts de preparación y migración', () => {
  const baseAuxiliar = 'restaurante_test_infra';

  it('prepararBaseDeDatos es idempotente', async () => {
    await prepararBaseDeDatos({ baseDeDatos: baseAuxiliar, recrear: true });
    await prepararBaseDeDatos({ baseDeDatos: baseAuxiliar });
    await prepararBaseDeDatos({ baseDeDatos: baseAuxiliar });
    await conCliente('admin', async (admin) => {
      const { rows } = await admin.query(
        'SELECT count(*)::int AS n FROM pg_database WHERE datname = $1',
        [baseAuxiliar],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('prepararBaseDeDatos oculta el texto de consultas ajenas en la base de destino (criterio 38b)', async () => {
    await prepararBaseDeDatos({ baseDeDatos: baseAuxiliar, recrear: true });
    // Una membresía de monitoreo que alguien haya dado a mano se quita al volver a preparar.
    await conCliente('admin', async (admin) => {
      await admin.query('GRANT pg_monitor TO restaurante_api');
    });
    await prepararBaseDeDatos({ baseDeDatos: baseAuxiliar });
    const admin = await abrirCliente('admin', baseAuxiliar);
    try {
      for (const rol of ['restaurante_api', 'restaurante_plataforma']) {
        const { rows } = await admin.query(
          `SELECT has_function_privilege($1, 'pg_stat_get_activity(integer)', 'EXECUTE') AS actividad,
                  has_function_privilege($1, 'pg_stat_get_backend_activity(integer)', 'EXECUTE') AS backend,
                  has_table_privilege($1, 'pg_catalog.pg_stat_activity', 'SELECT') AS vista,
                  pg_has_role($1, 'pg_read_all_stats', 'MEMBER') AS estadisticas,
                  pg_has_role($1, 'pg_monitor', 'MEMBER') AS monitor`,
          [rol],
        );
        expect(rows[0], rol).toEqual({
          actividad: false,
          backend: false,
          vista: false,
          estadisticas: false,
          monitor: false,
        });
      }
      // El monitoreo legítimo sigue disponible para pg_read_all_stats.
      const { rows } = await admin.query(
        `SELECT has_function_privilege('pg_read_all_stats', 'pg_stat_get_activity(integer)', 'EXECUTE') AS ok`,
      );
      expect(rows[0].ok).toBe(true);
    } finally {
      await admin.end();
    }
  });

  it('umzug descubre migraciones .ts, las aplica una sola vez y las revierte', async () => {
    await prepararBaseDeDatos({ baseDeDatos: baseAuxiliar, recrear: true });
    const url = urlDeRol('migrador', baseAuxiliar);
    const carpeta = join(__dirname, 'fixtures', 'migraciones');

    expect(await migrarArriba(url, carpeta)).toEqual(['202601010001-ejemplo.ts']);
    expect(await migrarArriba(url, carpeta)).toEqual([]);

    const cliente = new Client({ connectionString: url });
    await cliente.connect();
    try {
      const existe = () =>
        cliente
          .query(`SELECT to_regclass('public.ejemplo_migracion') AS tabla`)
          .then((r) => r.rows[0].tabla);
      expect(await existe()).toBe('ejemplo_migracion');
      expect(await revertirUltima(url, carpeta)).toBe('202601010001-ejemplo.ts');
      expect(await existe()).toBeNull();
    } finally {
      await cliente.end();
    }
  });

  it('con todas las migraciones ya aplicadas no hace nada (devuelve la lista vacía)', async () => {
    expect(await migrarArriba(urlDeRol('migrador'))).toEqual([]);
  });
});
