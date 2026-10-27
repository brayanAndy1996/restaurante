// spec: 001-base-multitenancy (pruebas protegidas)
//
// P15 · Criterio 22e inciso (f), por la API:
// - el ataque de la ronda 4 (`ts_rewrite` con `set_config` hacia B) y el de la revisión final (un comentario
//   `--` terminado en `\r` seguido de `set_config`) siguen sin ver, modificar ni crear filas de B dentro de
//   `ContextoEmpresa.ejecutar(A)`;
// - el SQL que esos ataques intentaban ejecutar, enviado directo a la base (sin la guarda), no cambia el
//   contexto;
// - la guarda rechaza antes de la base (con un error que no es `DatabaseError`) toda mención de
//   `fijar_contexto_empresa` fuera de literales y comentarios (también con `public.`, entre comillas dobles,
//   en mayúsculas, tras otra sentencia y tras comentarios), salvo la fijación propia de `ContextoEmpresa`;
//   un literal con ese texto se guarda o se compara tal cual (criterio 22b);
// - la fijación propia de `ContextoEmpresa.ejecutar` funciona, y la llamada anidada con la misma empresa
//   no vuelve a fijar (no falla con "contexto de empresa ya fijado").
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import { DatabaseError, QueryTypes, type Sequelize } from 'sequelize';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { CONEXION_API } from '../../src/nucleo/base-de-datos';
import { ContextoEmpresa } from '../../src/nucleo/contexto-empresa';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, fotoDeFila, textoUnico, type EmpresaSql } from './fabrica';

let app: INestApplication;
let sequelize: Sequelize;
let contexto: ContextoEmpresa;

/**
 * Sección 002 (P10): `ContextoEmpresa.ejecutar` con el actor de sistema `prueba`. Toda escritura de una
 * transacción necesita actor (criterio 115); estas pruebas siguen verificando lo mismo que antes.
 */
const ejecutarConActor = <T>(empresaId: string, fn: () => Promise<T>): Promise<T> =>
  contexto.ejecutar(empresaId, fn, { actor: { sistema: 'prueba' } });

let admin: Client;
let plataforma: Client;
let A: EmpresaSql;
let B: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba({ poolMax: 2 });
  app = await crearAplicacion();
  sequelize = app.get<Sequelize>(CONEXION_API);
  contexto = app.get(ContextoEmpresa);
  admin = await abrirCliente('admin');
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
  B = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
  await plataforma?.end();
});

type Fila = { id: string; nombre: string };
const consulta = () =>
  sequelize.query<Fila>('SELECT id, nombre FROM sucursal', { type: QueryTypes.SELECT });
const idsDe = (empresa: EmpresaSql) => empresa.sucursales.map((s) => s.id).sort();
const ordenados = (filas: Fila[]) => filas.map((f) => f.id).sort();

type Intento<T> = { ok: true; valor: T } | { ok: false; error: unknown };
async function intentar<T>(fn: () => Promise<T>): Promise<Intento<T>> {
  try {
    return { ok: true, valor: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

const describir = (valor: unknown) =>
  valor instanceof Error ? `${valor.constructor.name}: ${valor.message}` : JSON.stringify(valor);

async function fotoDeSucursalesDeB(): Promise<unknown[]> {
  return Promise.all(B.sucursales.map((s) => fotoDeFila(admin, 'sucursal', s.id)));
}

// --------------------------------------------------------------------------------------------------
// Los dos ataques históricos, por la API
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (f) · los ataques de la ronda 4 y de la revisión final siguen sin dar acceso a B', () => {
  const ATAQUES: [string, (b: string) => string][] = [
    [
      'ronda 4: ts_rewrite con set_config hacia B',
      (b) =>
        `SELECT ts_rewrite('x'::tsquery, 'SELECT set_config(''app.empresa_id'',''${b}'',true)::tsquery, ''y''::tsquery')`,
    ],
    [
      'revisión final: comentario -- terminado en \\r y set_config',
      (b) => `-- x\rSELECT set_config('app.empresa_id', '${b}', true)`,
    ],
    [
      'revisión final: SELECT 1; comentario -- terminado en \\r y set_config',
      (b) => `SELECT 1; --x\rSELECT set_config('app.empresa_id', '${b}', true)`,
    ],
  ];

  it.each(ATAQUES)(
    '%s: lanza un error y ninguna consulta posterior ve, modifica ni crea filas de B',
    async (_nombre, sqlDe) => {
      const sucursalDeB = B.sucursales[0]!.id;
      const antes = await fotoDeSucursalesDeB();

      const visto = await ejecutarConActor(A.id, async () => {
        const ataque = await intentar(() => sequelize.query(sqlDe(B.id)));
        const lectura = await intentar(consulta);
        const escritura = await intentar(() =>
          sequelize.query<{ id: string }>(
            `UPDATE sucursal SET direccion = 'X' WHERE id = '${sucursalDeB}' RETURNING id`,
            { type: QueryTypes.SELECT },
          ),
        );
        const insercion = await intentar(() =>
          sequelize.query(
            `INSERT INTO sucursal (empresa_id, emisor_id, nombre, codigo_establecimiento, direccion, creado_en, actualizado_en)
             VALUES ('${B.id}', '${B.emisores[0]!.id}', '${textoUnico('Intrusa')}', '0098', 'Calle falsa 1', now(), now())`,
          ),
        );
        return { ataque, lectura, escritura, insercion };
      });

      expect(visto.ataque.ok, 'la sentencia del ataque tuvo éxito').toBe(false);
      if (visto.lectura.ok) expect(ordenados(visto.lectura.valor)).toEqual(idsDe(A));
      if (visto.escritura.ok) expect(visto.escritura.valor).toEqual([]);
      expect(visto.insercion.ok, 'se creó una sucursal de B desde el contexto de A').toBe(false);
      // Con el actor fijado (sección 002, criterio 115) el rechazo no puede ser por falta de actor.
      const errorDeInsercion = (visto.insercion as { error: { parent?: { message?: string } } })
        .error;
      expect(
        errorDeInsercion.parent?.message ?? describir(errorDeInsercion),
        'la inserción ajena debía rechazarla la política RLS, no la falta de actor',
      ).not.toMatch(/contexto de actor ausente/);
      expect(await fotoDeSucursalesDeB()).toEqual(antes);
    },
  );
});

describe('criterio 22e (f) · el SQL de esos ataques, enviado directo a la base, no cambia el contexto', () => {
  const DIRECTOS: [string, (b: string) => string][] = [
    ['set_config directo', (b) => `SELECT set_config('app.empresa_id', '${b}', true)`],
    [
      'set_config tras un comentario -- terminado en \\r',
      (b) => `SELECT 1; --x\rSELECT set_config('app.empresa_id', '${b}', true)`,
    ],
    [
      'el SQL interno de ts_rewrite',
      (b) => `SELECT set_config('app.empresa_id', '${b}', true)::text, 'y'`,
    ],
  ];

  it.each(DIRECTOS)(
    '%s: empresa_actual() sigue siendo A y solo se ven filas de A',
    async (_nombre, sqlDe) => {
      const antes = await fotoDeSucursalesDeB();
      const api = await abrirCliente('api');
      try {
        await api.query('BEGIN');
        await api.query('SELECT fijar_contexto_empresa($1)', [A.id]);
        await api.query('SAVEPOINT ataque');
        // Con varias sentencias en el texto el cliente usa el protocolo simple: sin parámetros.
        try {
          await api.query(sqlDe(B.id));
        } catch {
          // Si la base lo rechaza, se vuelve al punto previo; si lo ejecuta, sigue adelante.
          await api.query('ROLLBACK TO SAVEPOINT ataque');
        }
        const actual = await api.query<{ id: string }>('SELECT empresa_actual()::text AS id');
        expect(actual.rows[0]!.id).toBe(A.id);
        const sucursales = await api.query<{ empresa_id: string }>(
          'SELECT empresa_id FROM sucursal',
        );
        expect(sucursales.rows.every((f) => f.empresa_id === A.id)).toBe(true);
        const borradas = await api.query('DELETE FROM sucursal WHERE id = $1', [
          B.sucursales[0]!.id,
        ]);
        expect(borradas.rowCount).toBe(0);
        await api.query('COMMIT');
      } finally {
        await api.query('ROLLBACK').catch(() => undefined);
        await api.end();
      }
      expect(await fotoDeSucursalesDeB()).toEqual(antes);
    },
  );
});

// --------------------------------------------------------------------------------------------------
// La guarda rechaza toda mención de fijar_contexto_empresa
// --------------------------------------------------------------------------------------------------
describe('criterio 22e (f) · la guarda rechaza fijar_contexto_empresa fuera de literales y comentarios', () => {
  const F = 'fijar_contexto_empresa';
  const MENCIONES: [string, (b: string) => string][] = [
    ['la llamada simple', (b) => `SELECT ${F}('${b}')`],
    ['en mayúsculas', (b) => `SELECT ${F.toUpperCase()}('${b}')`],
    ['en mayúsculas y minúsculas mezcladas', (b) => `SELECT Fijar_Contexto_Empresa('${b}')`],
    ['con el esquema public.', (b) => `SELECT public.${F}('${b}')`],
    ['con el esquema public. y mayúsculas', (b) => `SELECT PUBLIC.${F.toUpperCase()}('${b}')`],
    ['entre comillas dobles', (b) => `SELECT "${F}"('${b}')`],
    ['con esquema y comillas dobles', (b) => `SELECT "public"."${F}"('${b}')`],
    ['con esquema sin comillas y nombre entre comillas', (b) => `SELECT public."${F}"('${b}')`],
    ['como columna con alias', (b) => `SELECT ${F}('${b}') AS x`],
    ['dentro de una subconsulta', (b) => `SELECT * FROM (SELECT ${F}('${b}')) AS t`],
    ['en un WITH', (b) => `WITH x AS (SELECT ${F}('${b}')) SELECT * FROM x`],
    ['sin espacio ante el paréntesis y con espacios dentro', (b) => `SELECT(${F} ( '${b}' ))`],
    ['tras otra sentencia permitida', (b) => `SELECT 1; SELECT ${F}('${b}')`],
    ['tras un comentario de bloque', (b) => `/* x */ SELECT ${F}('${b}')`],
    ['tras un comentario de línea', (b) => `-- x\nSELECT ${F}('${b}')`],
    ['tras un comentario de línea terminado en \\r', (b) => `-- x\rSELECT ${F}('${b}')`],
    [
      'tras una sentencia y un comentario terminado en \\r',
      (b) => `SELECT 1; --x\rSELECT ${F}('${b}')`,
    ],
    ['tras un literal', (b) => `SELECT 'x' AS a, ${F}('${b}')`],
    ['con la misma empresa A', () => `SELECT ${F}('${A.id}')`],
  ];

  it.each(MENCIONES)(
    '%s se rechaza antes de la base (error que no es DatabaseError) y la transacción sigue sana con el contexto de A',
    async (_nombre, sqlDe) => {
      const antes = await fotoDeSucursalesDeB();
      const visto = await ejecutarConActor(A.id, async () => {
        const ataque = await intentar(() => sequelize.query(sqlDe(B.id)));
        const lectura = await intentar(consulta);
        return { ataque, lectura };
      });
      expect(visto.ataque.ok, 'la mención de fijar_contexto_empresa no se rechazó').toBe(false);
      const error = (visto.ataque as { error: unknown }).error;
      expect(error).toBeInstanceOf(Error);
      expect(error instanceof DatabaseError, `llegó a la base: ${describir(error)}`).toBe(false);
      // Prueba de que la sentencia no llegó a la base: la transacción no quedó abortada.
      expect(visto.lectura.ok, `la lectura posterior falló: ${describir(error)}`).toBe(true);
      if (visto.lectura.ok) expect(ordenados(visto.lectura.valor)).toEqual(idsDe(A));
      expect(await fotoDeSucursalesDeB()).toEqual(antes);
    },
  );

  it('con el texto como parámetro enlazado ($1) también se rechaza antes de la base', async () => {
    const visto = await ejecutarConActor(A.id, async () => {
      const ataque = await intentar(() =>
        sequelize.query(`SELECT ${F}($1)`, { bind: [B.id], type: QueryTypes.SELECT }),
      );
      const lectura = await intentar(consulta);
      return { ataque, lectura };
    });
    expect(visto.ataque.ok).toBe(false);
    expect((visto.ataque as { error: unknown }).error instanceof DatabaseError).toBe(false);
    expect(visto.lectura.ok).toBe(true);
  });

  it('un identificador con escapes Unicode (U&"…") que podría escribir el nombre se rechaza antes de la base', async () => {
    const visto = await ejecutarConActor(A.id, async () => {
      const ataque = await intentar(() =>
        sequelize.query(`SELECT U&"\\0066ijar_contexto_empresa"('${B.id}')`),
      );
      const lectura = await intentar(consulta);
      return { ataque, lectura };
    });
    expect(visto.ataque.ok).toBe(false);
    expect((visto.ataque as { error: unknown }).error instanceof DatabaseError).toBe(false);
    expect(visto.lectura.ok).toBe(true);
  });

  describe('controles', () => {
    it.each([
      ['comillas simples', `'${F}(x); fijar'`],
      ['E-string', `E'${F} \\n'`],
      ['comillas de dólar', `$$${F}('x')$$`],
      ['comillas de dólar con etiqueta', `$q$SELECT ${F}('x')$q$`],
    ])(
      'un literal con el texto (%s) se compara tal cual: la consulta se ejecuta y solo ve filas de A',
      async (_nombre, literal) => {
        const filas = await ejecutarConActor(A.id, () =>
          sequelize.query<{ id: string }>(`SELECT id FROM sucursal WHERE nombre <> ${literal}`, {
            type: QueryTypes.SELECT,
          }),
        );
        expect(filas.map((f) => f.id).sort()).toEqual(A.sucursales.map((s) => s.id).sort());
      },
    );

    it('un valor con el texto se guarda tal cual en una sucursal de A', async () => {
      const id = A.sucursales[0]!.id;
      await ejecutarConActor(A.id, () =>
        sequelize.query(
          `UPDATE sucursal SET direccion = '${F}(x); SELECT ${F}(y)' WHERE id = '${id}'`,
        ),
      );
      const { rows } = await admin.query<{ direccion: string }>(
        'SELECT direccion FROM sucursal WHERE id = $1',
        [id],
      );
      expect(rows[0]!.direccion).toBe(`${F}(x); SELECT ${F}(y)`);
    });

    it('un nombre de sucursal con el texto se guarda y se encuentra por ese valor', async () => {
      const id = A.sucursales[1]!.id;
      const nombre = `Sede ${F} ${Date.now()}`;
      await ejecutarConActor(A.id, () =>
        sequelize.query('UPDATE sucursal SET nombre = $1 WHERE id = $2', { bind: [nombre, id] }),
      );
      const filas = await ejecutarConActor(A.id, () =>
        sequelize.query<{ id: string }>('SELECT id FROM sucursal WHERE nombre = $1', {
          bind: [nombre],
          type: QueryTypes.SELECT,
        }),
      );
      expect(filas.map((f) => f.id)).toEqual([id]);
    });

    it('un comentario con el texto antes de un SELECT no se rechaza', async () => {
      for (const sql of [
        `/* ${F}('x') */ SELECT id FROM sucursal`,
        `-- ${F}\nSELECT id FROM sucursal`,
        `SELECT id FROM sucursal /* public.${F} */`,
      ]) {
        const filas = await ejecutarConActor(A.id, () =>
          sequelize.query<{ id: string }>(sql, { type: QueryTypes.SELECT }),
        );
        expect(filas, sql).toHaveLength(A.sucursales.length);
      }
    });

    it('un alias que contiene el texto como parte de otro identificador (mi_fijar_contexto_empresa_x) no es la función y pasa', async () => {
      const filas = await ejecutarConActor(A.id, () =>
        sequelize.query<{ x: number }>(`SELECT 1 AS mi_${F}_x`, { type: QueryTypes.SELECT }),
      );
      expect(filas).toHaveLength(1);
    });
  });
});

// --------------------------------------------------------------------------------------------------
// La fijación propia de ContextoEmpresa
// --------------------------------------------------------------------------------------------------
describe('criterio 22e · ContextoEmpresa.ejecutar fija con fijar_contexto_empresa como primera sentencia', () => {
  it('ejecutar(A) y ejecutar(B) en la misma app ven cada uno solo su empresa', async () => {
    const deA = await ejecutarConActor(A.id, consulta);
    const deB = await ejecutarConActor(B.id, consulta);
    expect(ordenados(deA)).toEqual(idsDe(A));
    expect(ordenados(deB)).toEqual(idsDe(B));
  });

  it('la llamada anidada con la misma empresa corre en la misma transacción y no vuelve a fijar (no falla con "ya fijado")', async () => {
    const resultado = await ejecutarConActor(A.id, async () => {
      const externa = await consulta();
      // La llamada anidada no vuelve a fijar ni el contexto ni el actor.
      const interna = await contexto.ejecutar(A.id, consulta);
      const despues = await consulta();
      return { externa, interna, despues };
    });
    expect(ordenados(resultado.externa)).toEqual(idsDe(A));
    expect(ordenados(resultado.interna)).toEqual(idsDe(A));
    expect(ordenados(resultado.despues)).toEqual(idsDe(A));
  });

  it('con cualquier consulta cruda, la base ve la empresa fijada por ejecutar (empresa_actual() = A)', async () => {
    const filas = await ejecutarConActor(A.id, () =>
      sequelize.query<{ id: string }>('SELECT empresa_actual()::text AS id', {
        type: QueryTypes.SELECT,
      }),
    );
    expect(filas).toEqual([{ id: A.id }]);
  });
});
