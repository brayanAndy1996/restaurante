// spec: 001-base-multitenancy (pruebas protegidas)
//
// P3 · Criterios 36 y 38: recorrido del catálogo (RLS forzada, políticas, privilegios, llaves
// compuestas) y permisos sobre la tabla de auditoría. Una tabla nueva sin RLS hace fallar esta suite.
//
// Actualizado por la sección 002 (P10, criterios 56 y 88): `auditoria` reemplaza a `auditoria_plataforma`
// (que deja de existir) en la lista del criterio 38. `auditoria` tiene `empresa_id` y política para
// `restaurante_api`, pero la API solo tiene SELECT e INSERT (bajo RLS), nunca UPDATE, DELETE ni TRUNCATE;
// `restaurante_plataforma` tiene SELECT e INSERT. Cada escritura corre con el actor de sistema fijado
// (criterio 115) y el actor de la fila lo pone la base (criterio 119).
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRES_DE_ROLES, abrirCliente } from '../utilidades';
import { conActor, crearEmpresaSql, errorDe, textoUnico } from './fabrica';

const { api, plataforma } = NOMBRES_DE_ROLES;

/**
 * Tablas con `empresa_id` que no tienen una única política de `restaurante_api` con `empresa_actual()` en
 * `USING` y en `WITH CHECK`. Ninguna (la lista vacía es parte de la regla del criterio 38): `auditoria` ya
 * no es una excepción, porque desde la sección 002 tiene `empresa_id` y la API solo ve y escribe lo de su
 * empresa. Lo que cambia para `auditoria` son los privilegios (ver el último punto del criterio 38).
 */
const TABLAS_CON_EMPRESA_ID_SIN_POLITICA_DE_API: string[] = [];

describe('criterio 38 · el catálogo cumple la regla para toda tabla, presente o futura', () => {
  let admin: Client;
  beforeAll(async () => {
    admin = await abrirCliente('admin');
  });
  afterAll(async () => {
    await admin.end();
  });

  async function tablasDePublic(): Promise<
    { nombre: string; oid: number; rls: boolean; forzada: boolean }[]
  > {
    const { rows } = await admin.query(
      `SELECT c.relname AS nombre, c.oid::int AS oid, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzada
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
    );
    return rows;
  }

  it('las tablas de la historia existen en public', async () => {
    const nombres = (await tablasDePublic()).map((t) => t.nombre);
    expect(nombres).toEqual(expect.arrayContaining(['empresa', 'emisor', 'sucursal', 'auditoria']));
  });

  it('auditoria_plataforma dejó de existir: sus filas pasaron a auditoria (criterio 56)', async () => {
    const nombres = (await tablasDePublic()).map((t) => t.nombre);
    expect(nombres).not.toContain('auditoria_plataforma');
  });

  it('toda tabla de public, salvo migraciones, tiene RLS activada y forzada', async () => {
    const tablas = (await tablasDePublic()).filter((t) => t.nombre !== 'migraciones');
    expect(tablas.length).toBeGreaterThanOrEqual(4);
    const sinRls = tablas.filter((t) => !t.rls || !t.forzada).map((t) => t.nombre);
    expect(sinRls, 'tablas sin RLS activada y forzada').toEqual([]);
  });

  it('toda tabla con empresa_id, más empresa, tiene una política para restaurante_api con empresa_actual() en USING y WITH CHECK', async () => {
    const { rows: tablas } = await admin.query<{ nombre: string }>(
      `SELECT c.relname AS nombre FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND (c.relname = 'empresa'
               OR EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = c.oid AND a.attname = 'empresa_id' AND NOT a.attisdropped))`,
    );
    const obligadas = tablas
      .map((t) => t.nombre)
      .filter((n) => !TABLAS_CON_EMPRESA_ID_SIN_POLITICA_DE_API.includes(n));
    expect(obligadas).toEqual(expect.arrayContaining(['empresa', 'emisor', 'sucursal']));

    const { rows: politicas } = await admin.query<{
      tabla: string;
      roles: string;
      usando: string | null;
      verificando: string | null;
    }>(
      `SELECT tablename AS tabla, array_to_string(roles, ',') AS roles, qual AS usando, with_check AS verificando
         FROM pg_policies WHERE schemaname = 'public'`,
    );
    for (const tabla of obligadas) {
      const deApi = politicas.filter((p) => p.tabla === tabla && p.roles.split(',').includes(api));
      const conFuncion = deApi.filter(
        (p) =>
          /empresa_actual\(\)/.test(p.usando ?? '') &&
          /empresa_actual\(\)/.test(p.verificando ?? ''),
      );
      expect(
        conFuncion.length,
        `${tabla}: falta una política de ${api} con empresa_actual()`,
      ).toBeGreaterThan(0);
    }
  });

  it.each([api, plataforma])(
    '%s no tiene TRUNCATE, REFERENCES ni TRIGGER sobre ninguna tabla ni CREATE sobre ningún esquema',
    async (rol) => {
      const tablas = await tablasDePublic();
      expect(tablas.length).toBeGreaterThanOrEqual(4);
      const conPrivilegio: string[] = [];
      for (const tabla of tablas) {
        for (const privilegio of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const { rows } = await admin.query(
            'SELECT has_table_privilege($1::name, $2::oid, $3::text) AS tiene',
            [rol, tabla.oid, privilegio],
          );
          if (rows[0].tiene) conPrivilegio.push(`${tabla.nombre}:${privilegio}`);
        }
      }
      expect(conPrivilegio).toEqual([]);

      const { rows: esquemas } = await admin.query<{ nombre: string; tiene: boolean }>(
        `SELECT nspname AS nombre, has_schema_privilege($1::name, oid, 'CREATE') AS tiene
           FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'`,
        [rol],
      );
      expect(esquemas.length).toBeGreaterThan(0);
      expect(esquemas.filter((e) => e.tiene).map((e) => e.nombre)).toEqual([]);
    },
  );

  it('toda llave foránea entre dos tablas con empresa_id incluye empresa_id en sus columnas', async () => {
    const { rows } = await admin.query<{
      nombre: string;
      tabla: string;
      referenciada: string;
      columnas: string[];
      columnasReferenciadas: string[];
    }>(
      `SELECT con.conname AS nombre, cl.relname AS tabla, cr.relname AS referenciada,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columnas,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS "columnasReferenciadas"
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_class cr ON cr.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attname = 'empresa_id' AND NOT a.attisdropped)
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attname = 'empresa_id' AND NOT a.attisdropped)`,
    );
    // Debe haber al menos la de sucursal -> emisor (emisor_id, empresa_id).
    expect(rows.map((f) => `${f.tabla}->${f.referenciada}`)).toContain('sucursal->emisor');
    for (const fk of rows) {
      expect(fk.columnas, `${fk.nombre} (columnas de ${fk.tabla})`).toContain('empresa_id');
      expect(fk.columnasReferenciadas, `${fk.nombre} (columnas de ${fk.referenciada})`).toContain(
        'empresa_id',
      );
    }
  });

  it('restaurante_api no tiene ningún privilegio sobre migraciones', async () => {
    const privilegios = 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
    const { rows } = await admin.query(
      `SELECT has_table_privilege($1::name, 'public.migraciones'::regclass, $2::text) AS tabla,
              has_any_column_privilege($1::name, 'public.migraciones'::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') AS columnas`,
      [api, privilegios],
    );
    expect(rows[0]).toEqual({ tabla: false, columnas: false });
  });

  it('restaurante_api solo tiene SELECT e INSERT sobre auditoria; restaurante_plataforma, SELECT e INSERT', async () => {
    const privilegios = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
    ];
    for (const rol of [api, plataforma]) {
      const tiene: string[] = [];
      for (const privilegio of privilegios) {
        const { rows } = await admin.query(
          `SELECT has_table_privilege($1::name, 'public.auditoria'::regclass, $2::text) AS tiene`,
          [rol, privilegio],
        );
        if (rows[0].tiene) tiene.push(privilegio);
      }
      expect(tiene, `privilegios de ${rol} sobre auditoria`).toEqual(['SELECT', 'INSERT']);
      const { rows } = await admin.query(
        `SELECT has_any_column_privilege($1::name, 'public.auditoria'::regclass, 'UPDATE, REFERENCES') AS columnas`,
        [rol],
      );
      expect(rows[0], `${rol}: privilegios de columna sobre auditoria`).toEqual({
        columnas: false,
      });
    }
  });
});

describe('criterio 36 · permisos sobre auditoria', () => {
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

  /** Inserta una fila de plataforma con el actor de sistema dado (lo copia el trigger, criterio 119). */
  const insertarFila = (actor: string, motivo: string) =>
    conActor(
      plataformaCliente,
      () =>
        plataformaCliente.query(
          `INSERT INTO auditoria (origen, accion, motivo, detalle, ocurrido_en)
           VALUES ('plataforma', 'prueba', $1, '{}'::jsonb, now())`,
          [motivo],
        ),
      { sistema: actor },
    );

  it('control · restaurante_plataforma sí puede insertar y leer su auditoría', async () => {
    const actor = textoUnico('actor-catalogo');
    await insertarFila(actor, 'control de permisos');
    const { rows } = await plataformaCliente.query(
      'SELECT actor_sistema FROM auditoria WHERE actor_sistema = $1',
      [actor],
    );
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['UPDATE', "UPDATE auditoria SET motivo = 'alterado'"],
    ['DELETE', 'DELETE FROM auditoria'],
    ['TRUNCATE', 'TRUNCATE auditoria'],
  ])('restaurante_plataforma no puede %s', async (_nombre, sql) => {
    const error = await errorDe(plataformaCliente.query(sql));
    expect(error.code, error.message).toBe('42501');
  });

  it('las filas de auditoría siguen intactas tras los intentos de modificación', async () => {
    const actor = textoUnico('actor-intacto');
    await insertarFila(actor, 'original');
    await errorDe(plataformaCliente.query("UPDATE auditoria SET motivo = 'alterado'"));
    await errorDe(plataformaCliente.query('DELETE FROM auditoria'));
    const { rows } = await plataformaCliente.query(
      'SELECT motivo FROM auditoria WHERE actor_sistema = $1',
      [actor],
    );
    expect(rows).toEqual([{ motivo: 'original' }]);
  });

  it.each([
    ['UPDATE', "UPDATE auditoria SET motivo = 'alterado'"],
    ['DELETE', 'DELETE FROM auditoria'],
    ['TRUNCATE', 'TRUNCATE auditoria'],
  ])('restaurante_api no puede %s (con contexto de empresa ni sin él)', async (_nombre, sql) => {
    const empresa = await crearEmpresaSql(plataformaCliente);
    const sinContexto = await errorDe(apiCliente.query(sql));
    expect(sinContexto.code, sinContexto.message).toBe('42501');
    await apiCliente.query('BEGIN');
    try {
      await apiCliente.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', ['prueba']);
      await apiCliente.query('SELECT fijar_contexto_empresa($1)', [empresa.id]);
      const conContexto = await errorDe(apiCliente.query(sql));
      expect(conContexto.code, conContexto.message).toBe('42501');
      // El rechazo es de permisos (no hay privilegio), no de una política.
      expect(conContexto.message).toMatch(/permission denied/i);
    } finally {
      await apiCliente.query('ROLLBACK');
    }
  });

  it('restaurante_api sin contexto de empresa no puede leer ni insertar en auditoria (42501)', async () => {
    const lectura = await errorDe(apiCliente.query('SELECT * FROM auditoria'));
    expect(lectura.code, lectura.message).toBe('42501');
    await apiCliente.query('BEGIN');
    try {
      // Con el actor fijado, el rechazo es el del contexto de empresa ausente y no el del actor.
      await apiCliente.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', ['prueba']);
      const insercion = await errorDe(
        apiCliente.query(
          `INSERT INTO auditoria (origen, accion, detalle, ocurrido_en)
           VALUES ('empresa', 'prueba', '{}'::jsonb, now())`,
        ),
      );
      expect(insercion.code, insercion.message).toBe('42501');
      expect(insercion.message).not.toMatch(/contexto de actor ausente/);
    } finally {
      await apiCliente.query('ROLLBACK');
    }
  });

  it('restaurante_api con el contexto de A solo ve las filas de A y no puede insertar filas sin empresa', async () => {
    const empresa = await crearEmpresaSql(plataformaCliente);
    const actor = textoUnico('actor-sin-empresa');
    await insertarFila(actor, 'fila de plataforma sin empresa');
    await apiCliente.query('BEGIN');
    try {
      await apiCliente.query('SELECT fijar_contexto_actor(NULL, NULL, NULL, $1)', ['prueba']);
      await apiCliente.query('SELECT fijar_contexto_empresa($1)', [empresa.id]);
      const visibles = await apiCliente.query<{ empresa_id: string | null }>(
        'SELECT empresa_id FROM auditoria',
      );
      expect(visibles.rows.every((f) => f.empresa_id === empresa.id)).toBe(true);
      await apiCliente.query('SAVEPOINT sin_empresa');
      const insercion = await errorDe(
        apiCliente.query(
          `INSERT INTO auditoria (origen, accion, detalle, ocurrido_en)
           VALUES ('empresa', 'prueba', '{}'::jsonb, now())`,
        ),
      );
      expect(insercion.code, insercion.message).toBe('42501');
      expect(insercion.message).toMatch(/row-level security/);
      await apiCliente.query('ROLLBACK TO SAVEPOINT sin_empresa');
    } finally {
      await apiCliente.query('ROLLBACK');
    }
  });
});
