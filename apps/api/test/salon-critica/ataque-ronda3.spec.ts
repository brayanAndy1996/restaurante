// spec: 004-salon-cocina (pruebas protegidas)
//
// Ataque adversarial, ronda 3, a la entrega 3a. Las dos fallas son de la guarda de nombres de la API
// (criterio 70 de 004; criterios 38c y 38e de 001). La guarda es la única barrera en producción, donde PostgreSQL
// es administrado y no hay superusuario: lo que no rechaza ella, llega a la base.
//
// Falla 1 · enumerar sesiones ajenas (38c). La guarda rechaza antes de la base (un error que no es
// `DatabaseError`) `pg_stat_ssl`, `pg_stat_gssapi`, `pg_stat_replication`, las vistas `pg_stat_progress_*`
// (`vacuum`, `analyze`, `create_index`, `cluster`, `basebackup`, `copy`) y la función `pg_stat_get_progress_info`.
//
// Falla 2 · ver el estado de las transacciones de otras empresas (38c). La guarda rechaza `pg_current_snapshot`,
// `txid_current_snapshot`, `pg_xact_status`, `txid_status`, `pg_current_xact_id`, `txid_current`, las funciones
// `pg_stat_get_db_*` (por ejemplo `pg_stat_get_db_numbackends`), `pg_stat_database`,
// `pg_stat_database_conflicts` y las funciones afines de instantáneas (`pg_snapshot_xmin`, `pg_snapshot_xmax`,
// `pg_snapshot_xip`, `txid_snapshot_*`, `pg_visible_in_snapshot`, `txid_visible_in_snapshot`,
// `pg_current_xact_id_if_assigned`, `txid_current_if_assigned`). Un caso reproduce el ataque: B abre una
// transacción y anota su xid; A consulta `pg_xact_status` y recibe el rechazo de la guarda, no `in progress`.
//
// Controles: esos nombres dentro de literales y comentarios siguen permitidos; un alias que los contenga dentro
// de otro identificador, también; `pg_advisory_xact_lock` sigue permitido.
//
// Se ejecutan por la API real (`ContextoEmpresa` y el `Sequelize` de `CONEXION_API`), como
// `ataque-ronda2.spec.ts` y `tiempo-real-aislamiento.spec.ts`, con las variantes de `variantes()`.
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { variantes, type EntradaProhibida } from '../aislamiento/nombres-prohibidos';
import { abrirCliente } from '../utilidades';
import { arrancarP2, prepararEscenarioP2, type AppP2, type EscenarioP2 } from './fabrica-p2';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let ctx: AppP2;
let admin: Client;
let esc: EscenarioP2;

const A = () => esc.e.A;

beforeAll(async () => {
  ctx = await arrancarP2();
  admin = await abrirCliente('admin');
  esc = await prepararEscenarioP2(ctx);
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
});

// ===================================================================================================
// Las entradas: una sentencia válida de PostgreSQL 16 que menciona cada nombre
// ===================================================================================================

const pgCatalog = 'pg_catalog' as const;

const SNAPSHOT = `'10:20:12'`;

/** Falla 1 · enumerar sesiones ajenas. */
const ENTRADAS_SESIONES: EntradaProhibida[] = [
  ...['pg_stat_ssl', 'pg_stat_gssapi', 'pg_stat_replication'].map((nombre): EntradaProhibida => ({
    nombre,
    grupo: '38c',
    sql: (n) => `SELECT * FROM ${n}`,
    esquema: pgCatalog,
  })),
  ...[
    'pg_stat_progress_vacuum',
    'pg_stat_progress_analyze',
    'pg_stat_progress_create_index',
    'pg_stat_progress_cluster',
    'pg_stat_progress_basebackup',
    'pg_stat_progress_copy',
  ].map((nombre): EntradaProhibida => ({
    nombre,
    grupo: '38c',
    sql: (n) => `SELECT * FROM ${n}`,
    esquema: pgCatalog,
  })),
  {
    nombre: 'pg_stat_get_progress_info',
    grupo: '38c',
    sql: (n) => `SELECT * FROM ${n}('VACUUM')`,
    esquema: pgCatalog,
  },
];

/** Falla 2 · ver el estado de las transacciones de otras empresas. */
const ENTRADAS_TRANSACCIONES: EntradaProhibida[] = [
  {
    nombre: 'pg_current_snapshot',
    grupo: '38c',
    sql: (n) => `SELECT ${n}()`,
    esquema: pgCatalog,
  },
  {
    nombre: 'txid_current_snapshot',
    grupo: '38c',
    sql: (n) => `SELECT ${n}()`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_xact_status',
    grupo: '38c',
    sql: (n) => `SELECT ${n}('1'::xid8)`,
    esquema: pgCatalog,
  },
  { nombre: 'txid_status', grupo: '38c', sql: (n) => `SELECT ${n}(1)`, esquema: pgCatalog },
  { nombre: 'pg_current_xact_id', grupo: '38c', sql: (n) => `SELECT ${n}()`, esquema: pgCatalog },
  { nombre: 'txid_current', grupo: '38c', sql: (n) => `SELECT ${n}()`, esquema: pgCatalog },
  {
    nombre: 'pg_current_xact_id_if_assigned',
    grupo: '38c',
    sql: (n) => `SELECT ${n}()`,
    esquema: pgCatalog,
  },
  {
    nombre: 'txid_current_if_assigned',
    grupo: '38c',
    sql: (n) => `SELECT ${n}()`,
    esquema: pgCatalog,
  },
  // Las funciones `pg_stat_get_db_*`: la del enunciado y otras del mismo prefijo.
  {
    nombre: 'pg_stat_get_db_numbackends',
    grupo: '38c',
    sql: (n) => `SELECT ${n}(1)`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_stat_get_db_xact_commit',
    grupo: '38c',
    sql: (n) => `SELECT ${n}(1)`,
    esquema: pgCatalog,
  },
  {
    nombre: 'pg_stat_get_db_tuples_returned',
    grupo: '38c',
    sql: (n) => `SELECT ${n}(1)`,
    esquema: pgCatalog,
  },
  // Prefijo: cualquier identificador que empiece así se rechaza, también un alias.
  { nombre: 'pg_stat_get_db_x', grupo: '38c', sql: (n) => `SELECT 1 AS ${n}` },
  ...['pg_stat_database', 'pg_stat_database_conflicts'].map((nombre): EntradaProhibida => ({
    nombre,
    grupo: '38c',
    sql: (n) => `SELECT * FROM ${n}`,
    esquema: pgCatalog,
  })),
  // Funciones afines de instantáneas (el argumento es un literal, para no mezclar otros nombres).
  ...['pg_snapshot_xmin', 'pg_snapshot_xmax'].map((nombre): EntradaProhibida => ({
    nombre,
    grupo: '38c',
    sql: (n) => `SELECT ${n}(${SNAPSHOT}::pg_snapshot)`,
    esquema: pgCatalog,
  })),
  {
    nombre: 'pg_snapshot_xip',
    grupo: '38c',
    sql: (n) => `SELECT * FROM ${n}(${SNAPSHOT}::pg_snapshot)`,
    esquema: pgCatalog,
  },
  ...['txid_snapshot_xmin', 'txid_snapshot_xmax'].map((nombre): EntradaProhibida => ({
    nombre,
    grupo: '38c',
    sql: (n) => `SELECT ${n}(${SNAPSHOT}::txid_snapshot)`,
    esquema: pgCatalog,
  })),
  {
    nombre: 'txid_snapshot_xip',
    grupo: '38c',
    sql: (n) => `SELECT * FROM ${n}(${SNAPSHOT}::txid_snapshot)`,
    esquema: pgCatalog,
  },
  // Prefijo `txid_snapshot_*`.
  { nombre: 'txid_snapshot_x', grupo: '38c', sql: (n) => `SELECT 1 AS ${n}` },
  {
    nombre: 'pg_visible_in_snapshot',
    grupo: '38c',
    sql: (n) => `SELECT ${n}('1'::xid8, ${SNAPSHOT}::pg_snapshot)`,
    esquema: pgCatalog,
  },
  {
    nombre: 'txid_visible_in_snapshot',
    grupo: '38c',
    sql: (n) => `SELECT ${n}(1, ${SNAPSHOT}::txid_snapshot)`,
    esquema: pgCatalog,
  },
];

const ALIAS_RONDA3 = [
  'mi_pg_stat_ssl',
  'x_pg_stat_gssapi',
  'mi_pg_stat_replication',
  'mi_pg_stat_progress_vacuum',
  'x_pg_stat_get_progress_info',
  'mi_pg_current_snapshot',
  'mi_txid_current_snapshot',
  'x_pg_xact_status',
  'mi_txid_status',
  'mi_pg_current_xact_id',
  'mi_txid_current',
  'mi_pg_stat_get_db_numbackends',
  'mi_pg_stat_database',
  'mi_pg_stat_database_conflicts',
  'mi_pg_snapshot_xmin',
  'x_pg_snapshot_xip',
  'mi_txid_snapshot_xmin',
  'mi_pg_visible_in_snapshot',
  'mi_txid_visible_in_snapshot',
  'mi_pg_current_xact_id_if_assigned',
  'mi_txid_current_if_assigned',
  // El nombre al principio de un identificador más largo, para los nombres exactos.
  'pg_stat_ssl_x',
  'pg_xact_status_x',
];

// ===================================================================================================
// Criterio 70 · la guarda de la API
// ===================================================================================================

describe('criterio 70 (ronda 3) · la guarda de la API rechaza antes de la base las sesiones y las transacciones ajenas', () => {
  let sequelize: Sequelize;
  let contexto: ContextoEmpresa;
  let sucursales: string[];

  beforeAll(async () => {
    sequelize = ctx.app.get<Sequelize>(CONEXION_API);
    contexto = ctx.app.get(ContextoEmpresa);
    const { rows } = await admin.query<{ id: string }>(
      `SELECT id FROM sucursal WHERE empresa_id = $1 ORDER BY id`,
      [A().empresaId],
    );
    sucursales = rows.map((r) => r.id).sort();
    expect(sucursales.length).toBeGreaterThanOrEqual(2);
  });

  type Fila = { id: string };
  const describir = (valor: unknown) =>
    valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : String(valor);

  /** Solo las filas devueltas (sin los metadatos del driver), para mensajes legibles. */
  const filasDe = (resultado: unknown): string =>
    JSON.stringify(Array.isArray(resultado) ? resultado[0] : (resultado ?? null)).slice(0, 300);

  interface Intento {
    error: unknown;
    resultado: unknown;
    lectura: Fila[] | string;
  }

  /** Corre `sql` dentro de `ejecutar(A)` y luego un SELECT sobre sucursal en la misma transacción. */
  async function intentar(sql: string): Promise<Intento> {
    return contexto.ejecutar(A().empresaId, async () => {
      let error: unknown;
      let resultado: unknown;
      try {
        resultado = await sequelize.query(sql);
      } catch (e) {
        error = e;
      }
      let lectura: Fila[] | string;
      try {
        lectura = await sequelize.query<Fila>('SELECT id FROM sucursal', {
          type: QueryTypes.SELECT,
        });
      } catch (e) {
        lectura = describir(e);
      }
      return { error, resultado, lectura };
    });
  }

  /** Texto con el problema, o `null` si la sentencia se rechazó antes de la base y la transacción sigue sana. */
  function problemaDe(visto: Intento): string | null {
    if (visto.error === undefined) {
      return `la sentencia tuvo éxito (no se rechazó): ${filasDe(visto.resultado)}`;
    }
    if (visto.error instanceof DatabaseError) return `llegó a la base: ${describir(visto.error)}`;
    if (!(visto.error instanceof Error))
      return `se lanzó un valor que no es un Error: ${String(visto.error)}`;
    if (typeof visto.lectura === 'string') return `el SELECT posterior falló: ${visto.lectura}`;
    const vistos = visto.lectura.map((f) => f.id).sort();
    if (JSON.stringify(vistos) !== JSON.stringify(sucursales)) {
      return `el SELECT posterior no devolvió solo las filas de A: ${vistos.join(',')}`;
    }
    return null;
  }

  async function problemaAlRechazar(sql: string): Promise<string | null> {
    return problemaDe(await intentar(sql));
  }

  async function exigirRechazoEnTodasSusVariantes(entrada: EntradaProhibida): Promise<void> {
    const problemas: string[] = [];
    for (const [descripcion, sql] of variantes(entrada)) {
      const problema = await problemaAlRechazar(sql);
      if (problema !== null)
        problemas.push(`[${descripcion}] ${JSON.stringify(sql)} → ${problema}`);
    }
    expect(problemas, problemas.join('\n')).toEqual([]);
  }

  describe('falla 1 · enumerar sesiones ajenas', () => {
    it.each(ENTRADAS_SESIONES.map((e) => [e.nombre, e] as const))(
      '%s se rechaza en todas sus variantes y el SELECT posterior solo ve filas de A',
      async (_nombre, entrada) => {
        await exigirRechazoEnTodasSusVariantes(entrada);
      },
    );
  });

  describe('falla 2 · ver el estado de las transacciones de otras empresas', () => {
    it.each(ENTRADAS_TRANSACCIONES.map((e) => [e.nombre, e] as const))(
      '%s se rechaza en todas sus variantes y el SELECT posterior solo ve filas de A',
      async (_nombre, entrada) => {
        await exigirRechazoEnTodasSusVariantes(entrada);
      },
    );

    describe('el ataque: A pregunta por la transacción abierta de B', () => {
      let clienteB: Client;

      beforeAll(async () => {
        clienteB = await abrirCliente('admin');
      });

      afterAll(async () => {
        await clienteB?.query('ROLLBACK').catch(() => undefined);
        await clienteB?.end();
      });

      it('pg_xact_status del xid de B: la guarda de A rechaza antes de la base, no devuelve "in progress"', async () => {
        await clienteB.query('BEGIN');
        try {
          const { rows } = await clienteB.query<{ xid: string }>(
            `SELECT pg_current_xact_id()::text AS xid`,
          );
          const xid = rows[0]!.xid;
          expect(xid).toMatch(/^\d+$/);

          // Sanidad: sin la guarda, la pregunta funciona y delata la transacción de B.
          const directa = await admin.query<{ estado: string }>(
            `SELECT pg_xact_status('${xid}'::xid8) AS estado`,
          );
          expect(directa.rows[0]!.estado).toBe('in progress');

          const visto = await intentar(`SELECT pg_xact_status('${xid}'::xid8) AS estado`);
          expect(problemaDe(visto)).toBeNull();
          expect(filasDe(visto.resultado)).not.toContain('in progress');
        } finally {
          await clienteB.query('ROLLBACK');
        }
      });

      it('txid_status del txid de B: la guarda de A rechaza antes de la base, no devuelve "in progress"', async () => {
        await clienteB.query('BEGIN');
        try {
          const { rows } = await clienteB.query<{ xid: string }>(
            `SELECT txid_current()::text AS xid`,
          );
          const xid = rows[0]!.xid;
          expect(xid).toMatch(/^\d+$/);

          const directa = await admin.query<{ estado: string }>(
            `SELECT txid_status(${xid}) AS estado`,
          );
          expect(directa.rows[0]!.estado).toBe('in progress');

          const visto = await intentar(`SELECT txid_status(${xid}) AS estado`);
          expect(problemaDe(visto)).toBeNull();
          expect(filasDe(visto.resultado)).not.toContain('in progress');
        } finally {
          await clienteB.query('ROLLBACK');
        }
      });

      it('la instantánea de A no deja ver el xid de B: pg_snapshot_xip(pg_current_snapshot()) se rechaza', async () => {
        await clienteB.query('BEGIN');
        try {
          const { rows } = await clienteB.query<{ xid: string }>(
            `SELECT pg_current_xact_id()::text AS xid`,
          );
          const xid = rows[0]!.xid;
          for (const sql of [
            `SELECT * FROM pg_snapshot_xip(pg_current_snapshot())`,
            `SELECT pg_current_snapshot()::text AS instantanea`,
            `SELECT txid_current_snapshot()::text AS instantanea`,
          ]) {
            const visto = await intentar(sql);
            expect(problemaDe(visto), sql).toBeNull();
            expect(filasDe(visto.resultado)).not.toContain(xid);
          }
        } finally {
          await clienteB.query('ROLLBACK');
        }
      });
    });
  });

  describe('controles', () => {
    it('pg_advisory_xact_lock sigue permitido', async () => {
      const filas = await contexto.ejecutar(A().empresaId, async () => {
        await sequelize.query('SELECT pg_advisory_xact_lock(424242424244)');
        return sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
      });
      expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
    });

    it.each(ALIAS_RONDA3)(
      'el alias %s (que contiene un nombre dentro de otro identificador) se ejecuta',
      async (alias) => {
        const filas = await contexto.ejecutar(A().empresaId, async () => {
          await sequelize.query(`SELECT 1 AS ${alias}`);
          return sequelize.query<Fila>('SELECT id FROM sucursal', { type: QueryTypes.SELECT });
        });
        expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
      },
    );

    it.each([
      [
        'comillas simples',
        `'pg_stat_ssl pg_stat_gssapi pg_stat_replication pg_stat_progress_vacuum pg_stat_get_progress_info pg_xact_status txid_current pg_stat_database'`,
      ],
      [
        'E-string',
        `E'pg_current_snapshot txid_status pg_stat_get_db_numbackends txid_snapshot_xmin pg_visible_in_snapshot'`,
      ],
      [
        'comillas de dólar',
        `$$pg_xact_status('1'::xid8); pg_current_xact_id(); pg_stat_database_conflicts$$`,
      ],
      [
        'comillas de dólar con etiqueta',
        `$q$txid_current_if_assigned pg_current_xact_id_if_assigned pg_snapshot_xip pg_stat_progress_copy$q$`,
      ],
    ])(
      'un UPDATE con un literal (%s) con esos nombres guarda el valor tal cual',
      async (_nombre, literal) => {
        const esperado = (await admin.query<{ v: string }>(`SELECT ${literal} AS v`)).rows[0]!.v;
        await contexto.ejecutar(
          A().empresaId,
          () =>
            sequelize.query(
              `UPDATE sucursal SET direccion = ${literal} WHERE id = '${sucursales[0]}'`,
            ),
          { actor: { sistema: 'prueba' } },
        );
        const { rows } = await admin.query<{ direccion: string }>(
          'SELECT direccion FROM sucursal WHERE id = $1',
          [sucursales[0]],
        );
        expect(rows[0]!.direccion).toBe(esperado);
      },
    );

    it.each([
      `/* pg_stat_ssl pg_stat_progress_vacuum pg_xact_status txid_current */ SELECT id FROM sucursal`,
      `-- pg_stat_get_db_numbackends pg_current_snapshot pg_stat_database\nSELECT id FROM sucursal`,
      `SELECT id FROM sucursal /* pg_snapshot_xmin txid_snapshot_xip pg_stat_get_progress_info */`,
    ])(
      'un comentario con esos nombres antes o después de un SELECT no se rechaza: %j',
      async (sql) => {
        const filas = await contexto.ejecutar(A().empresaId, () =>
          sequelize.query<Fila>(sql, { type: QueryTypes.SELECT }),
        );
        expect(filas.map((f) => f.id).sort()).toEqual(sucursales);
      },
    );
  });
});
