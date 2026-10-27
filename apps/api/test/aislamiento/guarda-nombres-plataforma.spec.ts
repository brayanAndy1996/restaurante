// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 38e, incisos (d) y (e): guarda por nombre de la conexión de plataforma. `restaurante_plataforma`
// no pasa por la guarda de la API: la guarda de su conexión aplica la misma lista de nombres (incluidos
// `set_config`, `pg_settings`, `ts_rewrite`, `ts_stat`, `query_to_xml*`, `cursor_to_xml*`, `app.empresa_id` y
// `fijar_contexto_empresa`, este último sin excepción), con los mismos límites de identificador y el mismo
// rechazo de `U&"…"`, a toda consulta dentro de `OperacionPlataforma.ejecutar` y de `consultar`. El rechazo
// es un error que no es `DatabaseError`; en `ejecutar` la operación falla y no queda en la base ningún
// cambio de `fn` ni su fila de auditoría (criterio 32b). Los controles funcionan.
// La lista y sus variantes están en `nombres-prohibidos.ts`.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { OperacionPlataforma, PlataformaEmpresasService } from '../../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { conActor, datosDeEmpresa, textoUnico } from './fabrica';
import { CONTROLES_ALIAS, ENTRADAS, ESCAPES_UNICODE, variantes } from './nombres-prohibidos';

let app: INestApplication;
let operacion: OperacionPlataforma;
let admin: Client;
let empresaId: string;
let nombreOriginal: string;

beforeAll(async () => {
  fijarEntornoDePrueba();
  app = await crearAplicacion({ logger: false });
  operacion = app.get(OperacionPlataforma);
  admin = await abrirCliente('admin');
  const datos = datosDeEmpresa();
  const resultado = await app
    .get(PlataformaEmpresasService)
    .registrarEmpresa(datos, { actor: textoUnico('actor-alta'), motivo: 'Alta para la guarda' });
  empresaId = resultado.empresaId;
  nombreOriginal = datos.nombre;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

const sequelizeDe = (tx: unknown) => (tx as { sequelize: Sequelize }).sequelize;
const describir = (valor: unknown) =>
  valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : String(valor);

async function nombreActual(): Promise<string> {
  const { rows } = await admin.query<{ nombre: string }>(
    'SELECT nombre FROM empresa WHERE id = $1',
    [empresaId],
  );
  return rows[0]!.nombre;
}

async function auditorias(actor: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM auditoria WHERE origen = 'plataforma' AND actor_sistema = $1",
    [actor],
  );
  return Number(rows[0]!.n);
}

/** `sql` dentro de `ejecutar`, tras un cambio de `fn`: debe rechazarse antes de la base y no dejar nada. */
async function problemaEnEjecutar(sql: string): Promise<string | null> {
  const actor = textoUnico('actor-guarda');
  const nombreNuevo = textoUnico('Cambiado-guarda');
  let error: unknown;
  try {
    await operacion.ejecutar(
      { actor, motivo: 'Prueba de la guarda por nombre', operacion: 'prueba_guarda' },
      async (tx) => {
        const sequelize = sequelizeDe(tx);
        await sequelize.query('UPDATE empresa SET nombre = :nombre WHERE id = :id', {
          transaction: tx,
          replacements: { nombre: nombreNuevo, id: empresaId },
        });
        await sequelize.query(sql, { transaction: tx });
      },
    );
  } catch (e) {
    error = e;
  }
  if (error === undefined) return 'la operación tuvo éxito (no se rechazó)';
  if (error instanceof DatabaseError) return `llegó a la base: ${describir(error)}`;
  if (!(error instanceof Error)) return `se lanzó un valor que no es un Error: ${String(error)}`;
  if ((await nombreActual()) !== nombreOriginal) return 'quedó el cambio de fn en la base';
  if ((await auditorias(actor)) !== 0) return 'quedó una fila de auditoría';
  return null;
}

/** `sql` dentro de `consultar`: debe rechazarse antes de la base. */
async function problemaEnConsultar(sql: string): Promise<string | null> {
  let error: unknown;
  try {
    await operacion.consultar(async (tx) => {
      await sequelizeDe(tx).query(sql, { transaction: tx });
    });
  } catch (e) {
    error = e;
  }
  if (error === undefined) return 'la consulta tuvo éxito (no se rechazó)';
  if (error instanceof DatabaseError) return `llegó a la base: ${describir(error)}`;
  if (!(error instanceof Error)) return `se lanzó un valor que no es un Error: ${String(error)}`;
  return null;
}

/** Sentencias propias de plataforma: el texto del parámetro de contexto fuera de literales. */
const PARAMETRO_DE_CONTEXTO: [string, string][] = [
  ['SHOW app.empresa_id', 'SHOW app.empresa_id'],
  ['SET LOCAL app.empresa_id', `SET LOCAL app.empresa_id = '00000000-0000-0000-0000-000000000000'`],
  [
    'SET app.empresa_id tras una sentencia',
    `SELECT 1; SET app.empresa_id TO '00000000-0000-0000-0000-000000000000'`,
  ],
];

describe('criterio 38e (d, e) · la guarda de plataforma rechaza por nombre dentro de ejecutar', () => {
  it.each(ENTRADAS.map((e) => [e.nombre, e] as const))(
    '%s se rechaza en todas sus variantes, sin dejar el cambio de fn ni la auditoría',
    async (_nombre, entrada) => {
      const problemas: string[] = [];
      for (const [descripcion, sql] of variantes(entrada)) {
        const problema = await problemaEnEjecutar(sql);
        if (problema !== null)
          problemas.push(`[${descripcion}] ${JSON.stringify(sql)} → ${problema}`);
      }
      expect(problemas, problemas.join('\n')).toEqual([]);
    },
  );

  it.each([...ESCAPES_UNICODE, ...PARAMETRO_DE_CONTEXTO])(
    '%s se rechaza',
    async (_descripcion, sql) => {
      expect(await problemaEnEjecutar(sql), sql).toBeNull();
    },
  );
});

describe('criterio 38e (d, e) · la guarda de plataforma rechaza por nombre dentro de consultar', () => {
  it.each(ENTRADAS.map((e) => [e.nombre, e] as const))(
    '%s se rechaza en todas sus variantes',
    async (_nombre, entrada) => {
      const problemas: string[] = [];
      for (const [descripcion, sql] of variantes(entrada)) {
        const problema = await problemaEnConsultar(sql);
        if (problema !== null)
          problemas.push(`[${descripcion}] ${JSON.stringify(sql)} → ${problema}`);
      }
      expect(problemas, problemas.join('\n')).toEqual([]);
    },
  );

  it.each([...ESCAPES_UNICODE, ...PARAMETRO_DE_CONTEXTO])(
    '%s se rechaza',
    async (_descripcion, sql) => {
      expect(await problemaEnConsultar(sql), sql).toBeNull();
    },
  );
});

describe('criterio 38e (e) · controles de la guarda de plataforma', () => {
  it('ejecutar: alias que contienen un nombre dentro de otro identificador funcionan y dejan su auditoría', async () => {
    const actor = textoUnico('actor-control');
    const columnas = CONTROLES_ALIAS.map((alias, i) => `${i + 1} AS ${alias}`).join(', ');
    const filas = await operacion.ejecutar(
      { actor, motivo: 'Control de alias', operacion: 'prueba_control' },
      (tx) =>
        sequelizeDe(tx).query(`SELECT ${columnas}`, { transaction: tx, type: QueryTypes.SELECT }),
    );
    expect(filas).toHaveLength(1);
    expect(await auditorias(actor)).toBe(1);
  });

  it('consultar: alias que contienen un nombre dentro de otro identificador funcionan', async () => {
    const columnas = CONTROLES_ALIAS.map((alias, i) => `${i + 1} AS ${alias}`).join(', ');
    const filas = await operacion.consultar((tx) =>
      sequelizeDe(tx).query(`SELECT ${columnas}`, { transaction: tx, type: QueryTypes.SELECT }),
    );
    expect(filas).toHaveLength(1);
  });

  it.each([
    ['comillas simples', `'lo_get pg_stat_activity set_config fijar_contexto_empresa'`],
    ['E-string', `E'lo_get pg_stat_activity set_config fijar_contexto_empresa'`],
    ['comillas de dólar', `$$lo_get pg_stat_activity set_config fijar_contexto_empresa$$`],
    ['con app.empresa_id', `'app.empresa_id'`],
  ])(
    'ejecutar: un UPDATE con un literal (%s) con esos nombres guarda el valor y deja su auditoría',
    async (_nombre, literal) => {
      const actor = textoUnico('actor-literal');
      const esperado = (await admin.query<{ v: string }>(`SELECT ${literal} AS v`)).rows[0]!.v;
      const nombre = await operacion.ejecutar(
        { actor, motivo: 'Control de literal', operacion: 'prueba_control' },
        async (tx) => {
          const sequelize = sequelizeDe(tx);
          await sequelize.query(
            `UPDATE empresa SET nombre = ${literal} WHERE id = '${empresaId}'`,
            {
              transaction: tx,
            },
          );
          const filas = await sequelize.query<{ nombre: string }>(
            `SELECT nombre FROM empresa WHERE id = '${empresaId}'`,
            { transaction: tx, type: QueryTypes.SELECT },
          );
          return filas[0]!.nombre;
        },
      );
      expect(nombre).toBe(esperado);
      expect(await auditorias(actor)).toBe(1);
      expect(await nombreActual()).toBe(esperado);
      // Se restablece el nombre para no afectar a las demás pruebas.
      await conActor(admin, () =>
        admin.query('UPDATE empresa SET nombre = $1 WHERE id = $2', [nombreOriginal, empresaId]),
      );
    },
  );

  it.each([
    `/* lo_get pg_stat_activity set_config */ SELECT id FROM empresa WHERE id = '${'00000000-0000-0000-0000-000000000000'}'`,
    `-- loread lowrite pg_largeobject\nSELECT 1`,
    `-- fijar_contexto_empresa\rSELECT 1`,
    `SELECT 1 /* table_to_xml schema_to_xml database_to_xml */`,
  ])('consultar: un comentario con esos nombres no se rechaza: %j', async (sql) => {
    await expect(
      operacion.consultar((tx) => sequelizeDe(tx).query(sql, { transaction: tx })),
    ).resolves.toBeDefined();
  });
});
