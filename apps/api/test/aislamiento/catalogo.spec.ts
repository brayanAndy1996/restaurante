// spec: 001-base-multitenancy (pruebas protegidas)
//
// P3 · Criterios 36 y 38: recorrido del catálogo (RLS forzada, políticas, privilegios, llaves
// compuestas) y permisos sobre `auditoria_plataforma`. Una tabla nueva sin RLS hace fallar esta suite.
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRES_DE_ROLES, abrirCliente } from '../utilidades';
import { crearEmpresaSql, errorDe, textoUnico } from './fabrica';

const { api, plataforma } = NOMBRES_DE_ROLES;

/**
 * `auditoria_plataforma` tiene una columna `empresa_id` (la empresa afectada), pero no es una tabla
 * de empresa: la API no tiene ningún privilegio sobre ella (criterio 38, último punto) y solo
 * `restaurante_plataforma` tiene política.
 */
const TABLAS_CON_EMPRESA_ID_SIN_POLITICA_DE_API = ['auditoria_plataforma'];

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
    expect(nombres).toEqual(
      expect.arrayContaining(['empresa', 'emisor', 'sucursal', 'auditoria_plataforma']),
    );
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

  it('restaurante_api no tiene ningún privilegio sobre migraciones ni auditoria_plataforma', async () => {
    const privilegios = 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';
    for (const tabla of ['migraciones', 'auditoria_plataforma']) {
      const { rows } = await admin.query(
        `SELECT has_table_privilege($1::name, ('public.' || $2::text)::regclass, $3::text) AS tabla,
                has_any_column_privilege($1::name, ('public.' || $2::text)::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') AS columnas`,
        [api, tabla, privilegios],
      );
      expect(rows[0], tabla).toEqual({ tabla: false, columnas: false });
    }
  });
});

describe('criterio 36 · permisos sobre auditoria_plataforma', () => {
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

  it('control · restaurante_plataforma sí puede insertar y leer su auditoría', async () => {
    const actor = textoUnico('actor-catalogo');
    await plataformaCliente.query(
      `INSERT INTO auditoria_plataforma (actor, operacion, motivo, detalle) VALUES ($1, 'prueba', 'control de permisos', '{}'::jsonb)`,
      [actor],
    );
    const { rows } = await plataformaCliente.query(
      'SELECT actor FROM auditoria_plataforma WHERE actor = $1',
      [actor],
    );
    expect(rows).toHaveLength(1);
  });

  it.each([
    ['UPDATE', "UPDATE auditoria_plataforma SET motivo = 'alterado'"],
    ['DELETE', 'DELETE FROM auditoria_plataforma'],
    ['TRUNCATE', 'TRUNCATE auditoria_plataforma'],
  ])('restaurante_plataforma no puede %s', async (_nombre, sql) => {
    const error = await errorDe(plataformaCliente.query(sql));
    expect(error.code, error.message).toBe('42501');
  });

  it('las filas de auditoría siguen intactas tras los intentos de modificación', async () => {
    const actor = textoUnico('actor-intacto');
    await plataformaCliente.query(
      `INSERT INTO auditoria_plataforma (actor, operacion, motivo, detalle) VALUES ($1, 'prueba', 'original', '{}'::jsonb)`,
      [actor],
    );
    await errorDe(plataformaCliente.query("UPDATE auditoria_plataforma SET motivo = 'alterado'"));
    await errorDe(plataformaCliente.query('DELETE FROM auditoria_plataforma'));
    const { rows } = await plataformaCliente.query(
      'SELECT motivo FROM auditoria_plataforma WHERE actor = $1',
      [actor],
    );
    expect(rows).toEqual([{ motivo: 'original' }]);
  });

  it.each([
    ['SELECT', 'SELECT * FROM auditoria_plataforma'],
    [
      'INSERT',
      `INSERT INTO auditoria_plataforma (actor, operacion, motivo, detalle) VALUES ('api', 'prueba', 'no debería', '{}'::jsonb)`,
    ],
    ['UPDATE', "UPDATE auditoria_plataforma SET motivo = 'alterado'"],
    ['DELETE', 'DELETE FROM auditoria_plataforma'],
  ])('restaurante_api no puede %s (con contexto de empresa ni sin él)', async (_nombre, sql) => {
    const empresa = await crearEmpresaSql(plataformaCliente);
    const sinContexto = await errorDe(apiCliente.query(sql));
    expect(sinContexto.code, sinContexto.message).toBe('42501');
    await apiCliente.query('BEGIN');
    try {
      await apiCliente.query('SELECT fijar_contexto_empresa($1)', [empresa.id]);
      const conContexto = await errorDe(apiCliente.query(sql));
      expect(conContexto.code, conContexto.message).toBe('42501');
    } finally {
      await apiCliente.query('ROLLBACK');
    }
  });
});
