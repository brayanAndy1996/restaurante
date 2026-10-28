// Historia 003, grupo C1 · aislamiento de `estacion`, `familia` y `producto` y sus restricciones (criterios 63
// a 66 en lo que toca a estas tres tablas). Pruebas del desarrollador (no protegidas): el archivo protegido
// `carta-critica/rls-carta.spec.ts` siembra las diez tablas a la vez y solo corre completo cuando existen todas
// (grupo C5); esta repite lo mismo para las tres que ya existen, con la misma técnica (rol `restaurante_api`,
// contexto y actor fijados a mano, y comprobando que el rechazo es el de la política y no el del actor).
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { abrirCliente } from '../utilidades';
import { enTransaccion, errorDe } from '../aislamiento/fabrica';
import {
  altaEmpresa,
  arrancar,
  nuevoSuperadmin,
  type AppDePrueba,
} from '../acceso/fabrica-plataforma';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const TABLAS = ['estacion', 'familia', 'producto'] as const;
type Tabla = (typeof TABLAS)[number];

let ctx: AppDePrueba;
let admin: Client;
let api: Client;

beforeAll(async () => {
  ctx = await arrancar();
  admin = await abrirCliente('admin');
  api = await abrirCliente('api');
});

afterAll(async () => {
  await ctx?.cerrar();
  await admin?.end();
  await api?.end();
});

interface Sembrada {
  empresaId: string;
  estacion: string;
  familia: string;
  producto: string;
}

const nombre = (prefijo: string) => `${prefijo} ${randomUUID().slice(0, 12)}`;

async function sembrar(empresaId: string): Promise<Sembrada> {
  const s: Sembrada = {
    empresaId,
    estacion: randomUUID(),
    familia: randomUUID(),
    producto: randomUUID(),
  };
  await enTransaccion(
    api,
    empresaId,
    async () => {
      await api.query(
        `INSERT INTO estacion (id, empresa_id, nombre, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, true, now(), now())`,
        [s.estacion, empresaId, nombre('Cocina')],
      );
      await api.query(
        `INSERT INTO familia (id, empresa_id, nombre, orden, activa, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 1, true, now(), now())`,
        [s.familia, empresaId, nombre('Fondos')],
      );
      await api.query(
        `INSERT INTO producto (id, empresa_id, familia_id, tipo, nombre, precio, se_vende_solo,
                               estacion_id, tipo_control_stock, orden, activo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, 'SIMPLE', $4, '25.00', true, $5, 'UNIDADES', 1, true, now(), now())`,
        [s.producto, empresaId, s.familia, nombre('Lomo'), s.estacion],
      );
    },
    { confirmar: true },
  );
  return s;
}

let sembradoPendiente: Promise<{ A: Sembrada; B: Sembrada }> | undefined;
function sembrado() {
  sembradoPendiente ??= (async () => {
    const sa = await nuevoSuperadmin(ctx);
    const A = await altaEmpresa(ctx, sa, { conSesion: false });
    const B = await altaEmpresa(ctx, sa, { conSesion: false });
    return { A: await sembrar(A.empresaId), B: await sembrar(B.empresaId) };
  })();
  return sembradoPendiente;
}

const idsDe = async (tabla: Tabla, empresaId: string): Promise<string[]> =>
  (
    await admin.query<{ id: string }>(`SELECT id FROM ${tabla} WHERE empresa_id = $1 ORDER BY id`, [
      empresaId,
    ])
  ).rows.map((f) => f.id);

const fotoDe = async (tabla: Tabla, empresaId: string) =>
  (
    await admin.query(
      `SELECT to_jsonb(t) AS fila FROM ${tabla} t WHERE empresa_id = $1 ORDER BY id::text`,
      [empresaId],
    )
  ).rows.map((f) => f.fila);

describe.each(TABLAS)('criterio 65 · %s', (tabla) => {
  it('lectura: con el contexto de A no se leen filas de B por id ni sin WHERE', async () => {
    const { A, B } = await sembrado();
    const idsA = await idsDe(tabla, A.empresaId);
    const idsB = await idsDe(tabla, B.empresaId);
    expect(idsA.length).toBeGreaterThan(0);
    await enTransaccion(api, A.empresaId, async () => {
      const todas = await api.query<{ id: string }>(`SELECT id FROM ${tabla}`);
      expect(todas.rows.map((f) => f.id).sort()).toEqual(idsA);
      expect(
        (await api.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[])`, [idsB])).rows,
      ).toEqual([]);
    });
  });

  it('actualización: por id y sin WHERE no toca B, y cambiar el dueño a B falla por la política (no por el actor)', async () => {
    const { A, B } = await sembrado();
    const idsB = await idsDe(tabla, B.empresaId);
    const idsA = await idsDe(tabla, A.empresaId);
    const antesB = await fotoDe(tabla, B.empresaId);
    await enTransaccion(api, A.empresaId, async () => {
      const porId = await api.query(
        `UPDATE ${tabla} SET empresa_id = empresa_id WHERE id = ANY($1::uuid[]) RETURNING id`,
        [idsB],
      );
      expect(porId.rowCount).toBe(0);
      const sinWhere = await api.query<{ id: string }>(
        `UPDATE ${tabla} SET empresa_id = empresa_id RETURNING id`,
      );
      expect(sinWhere.rows.map((f) => f.id).sort()).toEqual(idsA);
      await api.query('SAVEPOINT dueno');
      const cambio = await errorDe(
        api.query(`UPDATE ${tabla} SET empresa_id = $1 WHERE id = $2`, [B.empresaId, idsA[0]]),
      );
      expect(cambio.code, cambio.message).toBe('42501');
      expect(cambio.message).toMatch(/row-level security/);
      await api.query('ROLLBACK TO SAVEPOINT dueno');
    });
    expect(await fotoDe(tabla, B.empresaId)).toEqual(antesB);
  });

  it('borrado: la API no tiene DELETE (42501 por permisos), así que nada se borra', async () => {
    const { A } = await sembrado();
    await enTransaccion(api, A.empresaId, async () => {
      const error = await errorDe(api.query(`DELETE FROM ${tabla}`));
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/permission denied/i);
    });
  });

  it('inserción: una fila con el empresa_id de B falla por la política RLS y no se crea', async () => {
    const { A, B } = await sembrado();
    const idsAntes = await idsDe(tabla, B.empresaId);
    const copiar = `INSERT INTO ${tabla}
      SELECT (jsonb_populate_record(NULL::${tabla},
               to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text, 'empresa_id', $1::text))).*
        FROM ${tabla} x WHERE x.empresa_id = $2 LIMIT 1`;
    await enTransaccion(api, A.empresaId, async () => {
      const error = await errorDe(api.query(copiar, [B.empresaId, A.empresaId]));
      expect(error.code, error.message).toBe('42501');
      expect(error.message).toMatch(/row-level security/);
      expect(error.message).not.toMatch(/contexto de actor ausente/);
    });
    expect(await idsDe(tabla, B.empresaId)).toEqual(idsAntes);
  });

  it('sin actor fijado, la base rechaza la escritura con "contexto de actor ausente" (trazabilidad)', async () => {
    const { A } = await sembrado();
    await enTransaccion(
      api,
      A.empresaId,
      async () => {
        const error = await errorDe(api.query(`UPDATE ${tabla} SET empresa_id = empresa_id`));
        expect(error.code).toBe('42501');
        expect(error.message).toMatch(/contexto de actor ausente/);
      },
      { actor: false },
    );
  });
});

describe('criterio 66 · llaves foráneas compuestas con la empresa', () => {
  const casos = [
    { columna: 'familia_id', objetivo: 'familia' },
    { columna: 'estacion_id', objetivo: 'estacion' },
  ] as const;

  it.each(casos)(
    'producto.$columna que apunta a una fila de B falla igual que un id inexistente',
    async ({ columna, objetivo }) => {
      const { A, B } = await sembrado();
      const insertar = (valor: string) =>
        api.query(
          `INSERT INTO producto
           SELECT (jsonb_populate_record(NULL::producto,
                    to_jsonb(x) || jsonb_build_object('id', gen_random_uuid()::text,
                                                      'nombre', $2::text, '${columna}', $1::text))).*
             FROM producto x WHERE x.empresa_id = $3 LIMIT 1`,
          [valor, nombre('Copia'), A.empresaId],
        );
      const cruzada = await enTransaccion(api, A.empresaId, () => errorDe(insertar(B[objetivo])));
      const inexistente = await enTransaccion(api, A.empresaId, () =>
        errorDe(insertar(randomUUID())),
      );
      expect(cruzada.code, cruzada.message).toBe('23503');
      expect(inexistente.code).toBe('23503');
      expect(cruzada.constraint).toBeTruthy();
      expect(cruzada.constraint).toBe(inexistente.constraint);
      // La misma llave en una actualización.
      const actualizar = (valor: string) =>
        api.query(`UPDATE producto SET ${columna} = $1 WHERE empresa_id = $2`, [
          valor,
          A.empresaId,
        ]);
      const c2 = await enTransaccion(api, A.empresaId, () => errorDe(actualizar(B[objetivo])));
      expect(c2.code).toBe('23503');
      expect(c2.constraint).toBe(cruzada.constraint);
    },
  );
});

describe('restricciones de la base (criterio 7 y datos del modelo)', () => {
  const insertar = (empresaId: string, familia: string, estacion: string | null, campos: string) =>
    api.query(
      `INSERT INTO producto (empresa_id, familia_id, estacion_id, nombre, tipo_control_stock, orden, ${campos.split('|')[0]})
       VALUES ($1, $2, $3, $4, 'UNIDADES', 1, ${campos.split('|')[1]})`,
      [empresaId, familia, estacion, nombre('P')],
    );

  it('se_vende_solo = (precio IS NOT NULL) y combo o menú sin estación', async () => {
    const { A } = await sembrado();
    const malos: [string, string][] = [
      ['simple se vende solo sin precio', "tipo, se_vende_solo|'SIMPLE', true"],
      ['simple con precio sin venderse solo', "tipo, se_vende_solo, precio|'SIMPLE', false, 5"],
      ['precio 0', "tipo, se_vende_solo, precio|'SIMPLE', true, 0"],
      ['precio negativo', "tipo, se_vende_solo, precio|'SIMPLE', true, -1"],
      ['tipo desconocido', "tipo, se_vende_solo, precio|'OTRO', true, 5"],
      ['combo con estación', "tipo, se_vende_solo, precio|'COMBO', true, 5"],
      ['combo que no se vende solo', "tipo, se_vende_solo|'COMBO', false"],
    ];
    for (const [descripcion, campos] of malos) {
      const error = await enTransaccion(api, A.empresaId, () =>
        errorDe(insertar(A.empresaId, A.familia, A.estacion, campos)),
      );
      expect(error.code, `${descripcion}: ${error.message}`).toBe('23514');
    }
    // Un combo sin estación y con precio es válido.
    await enTransaccion(api, A.empresaId, () =>
      insertar(A.empresaId, A.familia, null, "tipo, se_vende_solo, precio|'COMBO', true, 22.9"),
    );
  });

  it('el nombre es único por empresa sin distinguir mayúsculas y el mismo en otra empresa no choca', async () => {
    const { A, B } = await sembrado();
    const n = nombre('Unico');
    const crear = (empresa: Sembrada, valor: string) =>
      api.query(
        `INSERT INTO familia (empresa_id, nombre, orden, activa) VALUES ($1, $2, 9, true)`,
        [empresa.empresaId, valor],
      );
    await enTransaccion(api, A.empresaId, async () => {
      await crear(A, n);
      const repetido = await errorDe(crear(A, n.toUpperCase()));
      expect(repetido.code).toBe('23505');
    });
    await enTransaccion(api, B.empresaId, () => crear(B, n));
  });

  it('las columnas de trazabilidad y las llaves hacia el equipo existen en las tres tablas', async () => {
    for (const tabla of TABLAS) {
      const { rows } = await admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [tabla],
      );
      const columnas = rows.map((r) => r.column_name);
      for (const c of [
        'creado_por_usuario_id',
        'creado_por_equipo_id',
        'creado_por_superadministrador_id',
        'creado_por_sistema',
        'actualizado_por_usuario_id',
        'actualizado_por_equipo_id',
        'actualizado_por_superadministrador_id',
        'actualizado_por_sistema',
      ]) {
        expect(columnas, `${tabla}.${c}`).toContain(c);
      }
      const llaves = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype = 'f' AND conname LIKE '%equipo_fk'`,
        [tabla],
      );
      expect(llaves.rows[0]!.n, `llaves de equipo de ${tabla}`).toBe(2);
    }
  });
});
