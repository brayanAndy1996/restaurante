// Historia 006 · caja, cobro y comprobantes, grupo C1 (T6) · prueba del desarrollador (no protegida) de las migraciones
// 1 a 3 de la entrega 6a (`202611040001-tasa-igv`, `202611040002-caja`, `202611040003-facturacion`): aplicadas sobre una
// base nueva crean las ocho tablas con RLS y su política, los privilegios de `restaurante_api` de "Permisos" (el
// `UPDATE` de `comprobante` solo por columna) y la trazabilidad; revertidas dejan el esquema idéntico al de antes, y
// vueltas a aplicar, idéntico al de después.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  crearBaseNueva,
  migrarHasta,
  revertirHasta,
  type BaseNueva,
} from '../acceso/fabrica-plataforma';
import { abrirCliente } from '../utilidades';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ULTIMA_ANTERIOR = '202611030001';
const PRIMERA_6A = '202611040001';
const TABLAS = [
  'emisor_tasa_igv',
  'caja',
  'turno',
  'turno_conteo',
  'movimiento_caja',
  'serie',
  'comprobante',
  'comprobante_linea',
] as const;

let base: BaseNueva;

beforeAll(async () => {
  base = await crearBaseNueva('m6a');
});
afterAll(async () => {
  await base?.eliminar();
});

/** Todo el esquema `public` que importa (columnas, restricciones, índices, políticas, privilegios, triggers). */
async function esquema(cliente: Client): Promise<string> {
  const consultas = {
    columnas: `SELECT c.relname AS tabla, a.attname AS columna, format_type(a.atttypid, a.atttypmod) AS tipo,
                      a.attnotnull AS no_nula, pg_get_expr(d.adbin, d.adrelid) AS defecto
                 FROM pg_attribute a
                 JOIN pg_class c ON c.oid = a.attrelid
                 LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
                ORDER BY 1, 2`,
    restricciones: `SELECT conrelid::regclass::text AS tabla, conname, pg_get_constraintdef(oid) AS definicion
                      FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
    indices: `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`,
    politicas: `SELECT tablename, policyname, roles::text, cmd, qual, with_check
                  FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`,
    rls: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
           WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`,
    privilegios: `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
                   WHERE table_schema = 'public' AND grantee LIKE 'restaurante_%' ORDER BY 1, 2, 3`,
    privilegiosPorColumna: `SELECT table_name, grantee, column_name, privilege_type
                              FROM information_schema.column_privileges
                             WHERE table_schema = 'public' AND grantee LIKE 'restaurante_%'
                               AND privilege_type = 'UPDATE' ORDER BY 1, 2, 3`,
    triggers: `SELECT tgrelid::regclass::text AS tabla, tgname FROM pg_trigger
                WHERE NOT tgisinternal AND tgrelid::regclass::text IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
                ORDER BY 1, 2`,
  };
  const resultado: Record<string, unknown[]> = {};
  for (const [nombre, sql] of Object.entries(consultas)) {
    resultado[nombre] = (await cliente.query(sql)).rows;
  }
  return JSON.stringify(resultado);
}

async function existentes(cliente: Client): Promise<string[]> {
  const r = await cliente.query<{ tabla: string }>(
    `SELECT tablename AS tabla FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])
      ORDER BY 1`,
    [[...TABLAS]],
  );
  return r.rows.map((f) => f.tabla);
}

describe('migraciones 1 a 3 de 6a', () => {
  it('suben, bajan sin dejar rastro y vuelven a subir idénticas', async () => {
    await migrarHasta(base.base, ULTIMA_ANTERIOR);
    const admin = await abrirCliente('admin', base.base);
    try {
      expect(await existentes(admin)).toEqual([]);
      const antes = await esquema(admin);

      const aplicadas = await migrarHasta(base.base, '202611040003');
      expect(aplicadas.map((n) => n.slice(0, 12))).toEqual([
        '202611040001',
        '202611040002',
        '202611040003',
      ]);
      expect(await existentes(admin)).toEqual([...TABLAS].sort());
      const despues = await esquema(admin);

      const revertidas = await revertirHasta(base.base, PRIMERA_6A);
      expect(revertidas.map((n) => n.slice(0, 12))).toEqual([
        '202611040003',
        '202611040002',
        '202611040001',
      ]);
      expect(await existentes(admin)).toEqual([]);
      expect(await esquema(admin), 'revertidas, el esquema es el de antes').toEqual(antes);

      await migrarHasta(base.base, '202611040003');
      expect(await esquema(admin), 'vueltas a subir, el esquema es el de después').toEqual(despues);
    } finally {
      await admin.end();
    }
  });

  it('cada tabla tiene RLS forzada, su política y los privilegios de "Permisos"; nadie recibe DELETE ni TRUNCATE', async () => {
    const admin = await abrirCliente('admin', base.base);
    try {
      const rls = await admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])`,
        [[...TABLAS]],
      );
      expect(rls.rows).toHaveLength(TABLAS.length);
      expect(rls.rows.every((f) => f.relrowsecurity && f.relforcerowsecurity)).toBe(true);
      const politicas = await admin.query<{ tablename: string; policyname: string }>(
        `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
        [[...TABLAS]],
      );
      for (const tabla of TABLAS) {
        expect(
          politicas.rows.filter((p) => p.tablename === tabla).map((p) => p.policyname),
          tabla,
        ).toEqual(expect.arrayContaining(['aislamiento_empresa', 'acceso_plataforma']));
      }
      const privilegios = await admin.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee = 'restaurante_api' AND table_name = ANY($1::text[])
          ORDER BY 1, 2`,
        [[...TABLAS]],
      );
      const deApi = (tabla: string) =>
        privilegios.rows.filter((f) => f.table_name === tabla).map((f) => f.privilege_type);
      expect(deApi('caja')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
      expect(deApi('turno')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
      expect(deApi('serie')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
      expect(deApi('emisor_tasa_igv')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
      for (const tabla of ['turno_conteo', 'movimiento_caja', 'comprobante', 'comprobante_linea']) {
        expect(deApi(tabla), tabla).toEqual(['INSERT', 'SELECT']);
      }
      // `comprobante` solo se actualiza por columna: el estado y la trazabilidad de quien lo cambia.
      const columnas = await admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_schema = 'public' AND table_name = 'comprobante' AND grantee = 'restaurante_api'
            AND privilege_type = 'UPDATE' ORDER BY 1`,
      );
      expect(columnas.rows.map((f) => f.column_name)).toEqual([
        'actualizado_en',
        'actualizado_por_equipo_id',
        'actualizado_por_sistema',
        'actualizado_por_superadministrador_id',
        'actualizado_por_usuario_id',
        'estado',
      ]);
      // La plataforma no toca ninguna.
      const deLaPlataforma = await admin.query(
        `SELECT 1 FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee = 'restaurante_plataforma' AND table_name = ANY($1::text[])`,
        [[...TABLAS]],
      );
      expect(deLaPlataforma.rowCount).toBe(0);
    } finally {
      await admin.end();
    }
  });
});
