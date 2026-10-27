// Prueba del desarrollador (no protegida) de T7: los ayudantes de migración `sqlTrazabilidad` y
// `sqlTablaDeEmpresaTrazable` sobre una tabla de prueba que se crea y se descarta dentro de una transacción
// del migrador (nunca queda nada en la base), y que `sqlTablaDeEmpresa` no cambió su salida.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  sqlQuitarTrazabilidad,
  sqlTablaDeEmpresa,
  sqlTablaDeEmpresaTrazable,
  sqlTrazabilidad,
} from '../src/migraciones/sql-tabla-de-empresa';
import { abrirCliente } from './utilidades';

let migrador: Client;

beforeAll(async () => {
  migrador = await abrirCliente('migrador');
});

afterAll(async () => {
  await migrador?.end();
});

const TABLA = `CREATE TABLE tabla_de_prueba (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  dato text
);`;

/** Corre `fn` dentro de una transacción del migrador que siempre se revierte. */
async function enTransaccionDescartable<T>(fn: () => Promise<T>): Promise<T> {
  await migrador.query('BEGIN');
  try {
    return await fn();
  } finally {
    await migrador.query('ROLLBACK');
  }
}

describe('sqlTablaDeEmpresaTrazable', () => {
  it('agrega RLS, política, privilegios, las ocho columnas, los CHECK, las llaves y el trigger', async () => {
    await enTransaccionDescartable(async () => {
      await migrador.query(TABLA);
      await migrador.query(
        sqlTablaDeEmpresaTrazable('tabla_de_prueba', {
          privilegiosApi: ['SELECT', 'INSERT'],
          privilegiosPlataforma: ['SELECT'],
        }),
      );
      const columnas = await migrador.query<{ attname: string; tipo: string }>(
        `SELECT attname::text, format_type(atttypid, atttypmod) AS tipo FROM pg_attribute
          WHERE attrelid = 'tabla_de_prueba'::regclass AND attnum > 0 AND NOT attisdropped
            AND (attname LIKE 'creado_por%' OR attname LIKE 'actualizado_por%') ORDER BY attname`,
      );
      expect(columnas.rows.map((c) => c.attname)).toEqual([
        'actualizado_por_equipo_id',
        'actualizado_por_sistema',
        'actualizado_por_superadministrador_id',
        'actualizado_por_usuario_id',
        'creado_por_equipo_id',
        'creado_por_sistema',
        'creado_por_superadministrador_id',
        'creado_por_usuario_id',
      ]);
      const restricciones = await migrador.query<{ conname: string; contype: string }>(
        `SELECT conname::text, contype::text FROM pg_constraint
          WHERE conrelid = 'tabla_de_prueba'::regclass AND contype IN ('c', 'f') ORDER BY conname`,
      );
      expect(restricciones.rows.map((r) => r.conname)).toEqual(
        expect.arrayContaining([
          'tabla_de_prueba_actualizado_por_ck',
          'tabla_de_prueba_actualizado_por_superadministrador_fk',
          'tabla_de_prueba_actualizado_por_usuario_fk',
          'tabla_de_prueba_creado_por_ck',
          'tabla_de_prueba_creado_por_superadministrador_fk',
          'tabla_de_prueba_creado_por_usuario_fk',
        ]),
      );
      const trigger = await migrador.query(
        `SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'tabla_de_prueba'::regclass AND NOT t.tgisinternal AND p.proname = 'trazabilidad'`,
      );
      expect(trigger.rows).toEqual([{ tgname: 'trazabilidad' }]);
      const rls = await migrador.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'tabla_de_prueba'::regclass`,
      );
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      const politicas = await migrador.query(
        `SELECT policyname FROM pg_policies WHERE tablename = 'tabla_de_prueba' ORDER BY policyname`,
      );
      expect(politicas.rows).toEqual([
        { policyname: 'acceso_plataforma' },
        { policyname: 'aislamiento_empresa' },
      ]);
    });
  });

  it('con filas existentes las llena con el actor de sistema indicado antes de agregar los CHECK', async () => {
    await enTransaccionDescartable(async () => {
      await migrador.query(TABLA);
      await migrador.query(
        "INSERT INTO tabla_de_prueba (empresa_id, dato) VALUES (gen_random_uuid(), 'previa')",
      );
      await migrador.query('ALTER TABLE tabla_de_prueba ENABLE ROW LEVEL SECURITY');
      await migrador.query('ALTER TABLE tabla_de_prueba FORCE ROW LEVEL SECURITY');
      await migrador.query(
        sqlTrazabilidad('tabla_de_prueba', { rellenarFilasExistentesCon: 'migracion:prueba' }),
      );
      // La RLS sigue forzada después del relleno.
      const rls = await migrador.query(
        `SELECT relforcerowsecurity FROM pg_class WHERE oid = 'tabla_de_prueba'::regclass`,
      );
      expect(rls.rows).toEqual([{ relforcerowsecurity: true }]);
      await migrador.query('ALTER TABLE tabla_de_prueba NO FORCE ROW LEVEL SECURITY');
      const filas = await migrador.query(
        'SELECT dato, creado_por_sistema, actualizado_por_sistema FROM tabla_de_prueba',
      );
      expect(filas.rows).toEqual([
        {
          dato: 'previa',
          creado_por_sistema: 'migracion:prueba',
          actualizado_por_sistema: 'migracion:prueba',
        },
      ]);
    });
  });

  it('sqlQuitarTrazabilidad deja la tabla sin columnas, restricciones ni trigger de trazabilidad', async () => {
    await enTransaccionDescartable(async () => {
      await migrador.query(TABLA);
      await migrador.query(sqlTrazabilidad('tabla_de_prueba'));
      await migrador.query(sqlQuitarTrazabilidad('tabla_de_prueba'));
      const columnas = await migrador.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = 'tabla_de_prueba'::regclass
            AND attnum > 0 AND NOT attisdropped AND attname LIKE '%\\_por\\_%'`,
      );
      expect(columnas.rows).toEqual([]);
      const triggers = await migrador.query(
        `SELECT 1 FROM pg_trigger WHERE tgrelid = 'tabla_de_prueba'::regclass AND NOT tgisinternal`,
      );
      expect(triggers.rows).toEqual([]);
    });
  });

  it('con llaveDeEquipo agrega las llaves compuestas hacia equipo (las tablas creadas después de la migración de equipos)', async () => {
    await enTransaccionDescartable(async () => {
      await migrador.query(TABLA);
      await migrador.query(
        sqlTablaDeEmpresaTrazable('tabla_de_prueba', {
          privilegiosApi: ['SELECT'],
          llaveDeEquipo: true,
        }),
      );
      const llaves = await migrador.query<{ conname: string; columnas: string[]; destino: string }>(
        `SELECT con.conname::text,
                (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(n, ord)
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n) AS columnas,
                con.confrelid::regclass::text AS destino
           FROM pg_constraint con
          WHERE con.conrelid = 'tabla_de_prueba'::regclass AND con.conname LIKE '%\\_equipo\\_fk'
          ORDER BY con.conname`,
      );
      expect(llaves.rows).toEqual([
        {
          conname: 'tabla_de_prueba_actualizado_por_equipo_fk',
          columnas: ['actualizado_por_equipo_id', 'empresa_id'],
          destino: 'equipo',
        },
        {
          conname: 'tabla_de_prueba_creado_por_equipo_fk',
          columnas: ['creado_por_equipo_id', 'empresa_id'],
          destino: 'equipo',
        },
      ]);
    });
  });

  it('rechaza identificadores que no son nombres de tabla simples', () => {
    for (const malo of ['tabla; DROP TABLE x', 'Tabla', 'a-b', '', 'esquema.tabla']) {
      expect(() => sqlTrazabilidad(malo), malo).toThrow(/Identificador/);
      expect(() => sqlTablaDeEmpresaTrazable(malo, { privilegiosApi: ['SELECT'] }), malo).toThrow(
        /Identificador/,
      );
    }
    expect(() => sqlTrazabilidad('tabla_de_prueba', { columnaEmpresa: 'x; DROP TABLE y' })).toThrow(
      /Identificador/,
    );
  });
});

describe('sqlTablaDeEmpresa no cambia (las migraciones de 001 ya aplicadas lo usan)', () => {
  it('no menciona la trazabilidad y con privilegiosPlataforma vacío solo agrega la política', () => {
    const sql = sqlTablaDeEmpresa('tabla_de_prueba', {
      privilegiosApi: ['SELECT'],
      privilegiosPlataforma: ['SELECT', 'INSERT'],
    });
    expect(sql).not.toMatch(/creado_por|actualizado_por|trazabilidad/);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON tabla_de_prueba TO restaurante_plataforma/);
    const sinPrivilegios = sqlTablaDeEmpresa('tabla_de_prueba', {
      privilegiosApi: ['SELECT'],
      privilegiosPlataforma: [],
    });
    expect(sinPrivilegios).toMatch(/CREATE POLICY acceso_plataforma/);
    expect(sinPrivilegios).not.toMatch(/GRANT .* TO restaurante_plataforma/);
  });
});
