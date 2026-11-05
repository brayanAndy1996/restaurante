// Historia 006 · caja, cobro y comprobantes, grupo C4 (T15) · prueba del desarrollador (no protegida) de la migración 4
// de la entrega 6a (`202611040004-cobros`): aplicada sobre una base con las migraciones 1 a 3 crea `cobro` y `pago` con
// RLS forzada y su política, solo SELECT e INSERT para `restaurante_api`, las restricciones de "Columnas exactas de 6a" y
// la trazabilidad; revertida deja el esquema idéntico al de antes y vuelta a aplicar, idéntico al de después.
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

const ANTERIOR = '202611040003';
const COBROS = '202611040004';
const TABLAS = ['cobro', 'pago'] as const;

let base: BaseNueva;

beforeAll(async () => {
  base = await crearBaseNueva('m6a4');
});
afterAll(async () => {
  await base?.eliminar();
});

async function esquema(cliente: Client): Promise<string> {
  const consultas = [
    `SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY 1, 2`,
    `SELECT conrelid::regclass::text AS tabla, conname, pg_get_constraintdef(oid), condeferrable, condeferred
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`,
    `SELECT tablename, policyname, roles::text, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`,
    `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee LIKE 'restaurante_%' ORDER BY 1, 2, 3`,
    `SELECT tgrelid::regclass::text AS tabla, tgname FROM pg_trigger WHERE NOT tgisinternal
      AND tgrelid::regclass::text IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') ORDER BY 1, 2`,
  ];
  const resultado: unknown[] = [];
  for (const sql of consultas) resultado.push((await cliente.query(sql)).rows);
  return JSON.stringify(resultado);
}

async function existentes(cliente: Client): Promise<string[]> {
  const r = await cliente.query<{ tabla: string }>(
    `SELECT tablename AS tabla FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY 1`,
    [[...TABLAS]],
  );
  return r.rows.map((f) => f.tabla);
}

describe('migración 4 de 6a (cobro y pago)', () => {
  it('sube, baja sin dejar rastro y vuelve a subir idéntica', async () => {
    await migrarHasta(base.base, ANTERIOR);
    const admin = await abrirCliente('admin', base.base);
    try {
      expect(await existentes(admin)).toEqual([]);
      const antes = await esquema(admin);
      expect((await migrarHasta(base.base, COBROS)).map((n) => n.slice(0, 12))).toEqual([COBROS]);
      expect(await existentes(admin)).toEqual([...TABLAS].sort());
      const despues = await esquema(admin);
      expect((await revertirHasta(base.base, COBROS)).map((n) => n.slice(0, 12))).toEqual([COBROS]);
      expect(await existentes(admin)).toEqual([]);
      expect(await esquema(admin), 'revertida, el esquema es el de antes').toEqual(antes);
      await migrarHasta(base.base, COBROS);
      expect(await esquema(admin), 'vuelta a subir, el esquema es el de después').toEqual(despues);
    } finally {
      await admin.end();
    }
  });

  it('RLS forzada con su política, solo SELECT e INSERT, restricciones y trazabilidad', async () => {
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
      expect(rls.rows).toHaveLength(2);
      expect(rls.rows.every((f) => f.relrowsecurity && f.relforcerowsecurity)).toBe(true);
      const politicas = await admin.query<{ tablename: string; policyname: string }>(
        `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
        [[...TABLAS]],
      );
      for (const tabla of TABLAS) {
        expect(
          politicas.rows.filter((p) => p.tablename === tabla).map((p) => p.policyname),
        ).toEqual(expect.arrayContaining(['aislamiento_empresa', 'acceso_plataforma']));
      }
      const privilegios = await admin.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee = 'restaurante_api' AND table_name = ANY($1::text[]) ORDER BY 1, 2`,
        [[...TABLAS]],
      );
      for (const tabla of TABLAS) {
        expect(
          privilegios.rows.filter((f) => f.table_name === tabla).map((f) => f.privilege_type),
          tabla,
        ).toEqual(['INSERT', 'SELECT']);
      }
      const plataforma = await admin.query(
        `SELECT 1 FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND grantee = 'restaurante_plataforma' AND table_name = ANY($1::text[])`,
        [[...TABLAS]],
      );
      expect(plataforma.rowCount).toBe(0);
      const triggers = await admin.query<{ tabla: string }>(
        `SELECT tgrelid::regclass::text AS tabla FROM pg_trigger
          WHERE NOT tgisinternal AND tgrelid::regclass::text = ANY($1::text[])`,
        [[...TABLAS]],
      );
      expect(triggers.rows.map((f) => f.tabla).sort()).toEqual(
        expect.arrayContaining(['cobro', 'pago']),
      );

      const restricciones = await admin.query<{ conrelid: string; conname: string; def: string }>(
        `SELECT conrelid::regclass::text AS conrelid, conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE conrelid = ANY(ARRAY['cobro'::regclass, 'pago'::regclass])`,
      );
      const def = (nombre: string) =>
        restricciones.rows.find((r) => r.conname === nombre)?.def ?? '';
      expect(def('cobro_pk')).toBe('PRIMARY KEY (empresa_id, id)');
      expect(def('cobro_comprobante_unico')).toBe(
        'UNIQUE (empresa_id, comprobante_id) DEFERRABLE INITIALLY DEFERRED',
      );
      expect(def('cobro_orden_fk')).toContain('REFERENCES orden(id, empresa_id)');
      expect(def('cobro_turno_fk')).toContain('REFERENCES turno(id, empresa_id)');
      expect(def('cobro_comprobante_fk')).toContain('REFERENCES comprobante(id, empresa_id)');
      expect(def('pago_cobro_fk')).toContain('REFERENCES cobro(id, empresa_id)');
      expect(def('pago_turno_fk')).toContain('REFERENCES turno(id, empresa_id)');
      expect(def('pago_operacion_ck')).toContain("medio = 'EFECTIVO'");
      expect(def('pago_recibido_ck')).toContain('recibido >= monto');
      expect(
        restricciones.rows.find((r) => r.conname.startsWith('cobro_modo'))?.def ?? '',
      ).toContain('TOTAL');
    } finally {
      await admin.end();
    }
  });
});
